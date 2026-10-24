package mailstore

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"os"
	"strings"
	"testing"
	"time"
)

func syntheticProtocolFixture() (MailCommitBinding, MailCanonicalGrant, MailCommitProof, time.Time) {
	now := time.Date(2026, 10, 24, 12, 0, 0, 0, time.UTC)
	scope := Scope{uuid(), uuid(), uuid()}
	hash := strings.Repeat("a", 64)
	raw := Object{draftPrefix(scope) + "synthetic-original.eml", 1, hash, 123}
	b := MailCommitBinding{ObjectStoreRef: "local-fixture", EffectID: uuid(), Scope: scope, DeliveryID: "synthetic-protocol-" + uuid(), MailInputSHA256: hash, Raw: raw, AdmissionID: uuid(), ArtifactID: uuid(), FileID: uuid(), ScanReceiptID: uuid(), CanonicalBindingSHA256: strings.Repeat("b", 64), RuntimeFenceRef: "synthetic-runtime-step-fence-1"}
	g := MailCanonicalGrant{b.ArtifactID, b.CanonicalBindingSHA256, "synthetic-authority-revision-1", b.RuntimeFenceRef, now.Add(30 * time.Second)}
	r := Receipt{ID: uuid(), MessageID: uuid(), DeliveryID: b.DeliveryID, Raw: raw, Ledger: Object{draftPrefix(scope) + "synthetic-ledger.json", 1, hash, 99}, Release: "source-only-synthetic", ObservedAt: now}
	proof := MailCommitProof{ObjectStoreRef: b.ObjectStoreRef, Version: 1, Kind: MailQuarantineProofKind, EffectID: b.EffectID, BindingSHA256: b.CanonicalBindingSHA256, Scope: scope, MailInputSHA256: b.MailInputSHA256, Receipt: r, Attachments: []Object{}, SecurityState: "quarantined"}
	return b, g, proof, now
}
func TestMailCommitProtocol(t *testing.T) {
	b, g, p, now := syntheticProtocolFixture()
	canonical := MailCanonicalStatus{"SEALED", b.ArtifactID, b.CanonicalBindingSHA256, digest(encoded(p))}
	apply := func(t *testing.T, s MailCommitSnapshot, kind string, grant *MailCanonicalGrant, proof *MailCommitProof, status *MailCanonicalStatus) MailCommitSnapshot {
		t.Helper()
		event := MailCommitEvent{uuid(), s.Revision, kind, grant, proof, status}
		out, err := AdvanceMailCommit(s, event, now)
		if err != nil {
			t.Fatalf("%s from %s: %v", kind, s.State, err)
		}
		// Simulate Runtime journal restart after EVERY transition. This is a model
		// test, not a claim that Runtime's production persistence adapter is wired.
		var restored MailCommitSnapshot
		if err = json.Unmarshal(encoded(out.Snapshot), &restored); err != nil {
			t.Fatal(err)
		}
		if restored.PermitsCustomerAccess() {
			t.Fatal("private commit conferred access")
		}
		duplicate, err := AdvanceMailCommit(restored, event, now.Add(time.Hour))
		if err != nil || duplicate.NextAction != "NONE" || !bytes.Equal(encoded(duplicate.Snapshot), encoded(restored)) {
			t.Fatal("replay repeated effect", err)
		}
		return restored
	}
	path := func(t *testing.T, cut int) MailCommitSnapshot {
		s, err := NewMailCommitPlan(b)
		if err != nil {
			t.Fatal(err)
		}
		events := []string{"request_claim", "claim_observed", "request_mail_commit", "mail_commit_observed", "request_seal", "seal_observed"}
		for _, kind := range events[:cut] {
			s = apply(t, s, kind, &g, &p, &canonical)
		}
		return s
	}
	t.Run("serialized_happy_path_never_releases_bytes", func(t *testing.T) {
		s := path(t, 6)
		if s.State != "SEALED_PRIVATE" || s.Proof.Receipt.ID != p.Receipt.ID {
			t.Fatal(s)
		}
	})
	for cut := 0; cut <= 6; cut++ {
		t.Run("revocation_cut_"+[]string{"staged", "claim_pending", "prepared", "mail_pending", "mail_committed", "seal_pending", "sealed"}[cut], func(t *testing.T) {
			s := path(t, cut)
			s = apply(t, s, "revocation_observed", nil, nil, nil)
			switch cut {
			case 0, 2, 4:
				if s.State != "REFUSED_PRIVATE" {
					t.Fatal(s.State)
				}
			case 1, 3, 5:
				if s.State != "RECONCILIATION_REQUIRED" {
					t.Fatal(s.State)
				}
			case 6:
				if s.State != "SEALED_PRIVATE" || s.Proof.Receipt.ID != p.Receipt.ID {
					t.Fatal("historical seal erased")
				}
			}
			if _, err := AdvanceMailCommit(s, MailCommitEvent{uuid(), s.Revision, "request_seal", &g, nil, nil}, now); err == nil {
				t.Fatal("revoked execution resumed")
			}
			if cut == 3 {
				abandoned := MailCanonicalStatus{"ABANDONED", b.ArtifactID, b.CanonicalBindingSHA256, ""}
				s = apply(t, s, "reconcile_observed", nil, nil, &abandoned)
				if s.State != "RECONCILIATION_REQUIRED" {
					t.Fatal("absence invented a fenced abort")
				}
				s = apply(t, s, "reconcile_observed", nil, &p, &abandoned)
				if s.State != "REFUSED_PRIVATE" || s.Proof.Receipt.ID != p.Receipt.ID {
					t.Fatal("late private commit lost")
				}
			}
			if cut == 5 {
				s = apply(t, s, "reconcile_observed", nil, &p, &canonical)
				if s.State != "SEALED_PRIVATE" || !s.RevocationObserved {
					t.Fatal("lost seal acknowledgement did not preserve history")
				}
			}
		})
	}
	t.Run("unknown_commit_never_replays_writes_or_renews_claim", func(t *testing.T) {
		for _, cut := range []int{1, 3, 5} {
			s := path(t, cut)
			s = apply(t, s, "outcome_unknown", nil, nil, nil)
			status := MailCanonicalStatus{"RECONCILIATION_REQUIRED", b.ArtifactID, b.CanonicalBindingSHA256, ""}
			s = apply(t, s, "reconcile_observed", nil, nil, &status)
			for _, kind := range []string{"request_claim", "claim_observed", "request_mail_commit", "request_seal"} {
				if _, err := AdvanceMailCommit(s, MailCommitEvent{uuid(), s.Revision, kind, &g, &p, &canonical}, now); err == nil {
					t.Fatal("uncertain effect replayed", kind)
				}
			}
		}
	})
	t.Run("missing_status_proof_digest_is_not_sealed_acceptance", func(t *testing.T) {
		s := path(t, 5)
		s = apply(t, s, "outcome_unknown", nil, nil, nil)
		status := canonical
		status.MailProofSHA256 = ""
		if _, err := AdvanceMailCommit(s, MailCommitEvent{uuid(), s.Revision, "reconcile_observed", nil, &p, &status}, now); err == nil {
			t.Fatal("Runtime's present status-only reply treated as new Mail proof")
		}
	})
	t.Run("reject_substitution_expiry_stale_revision_and_changed_retry", func(t *testing.T) {
		prepared := path(t, 2)
		for _, change := range []string{"expired", "revision", "fence", "artifact", "binding"} {
			bad := g
			switch change {
			case "expired":
				bad.ExpiresAt = now
			case "revision":
				bad.AuthorityRevision = "changed"
			case "fence":
				bad.RuntimeFenceRef = "other"
			case "artifact":
				bad.ArtifactID = uuid()
			case "binding":
				bad.BindingSHA256 = strings.Repeat("c", 64)
			}
			if _, err := AdvanceMailCommit(prepared, MailCommitEvent{uuid(), prepared.Revision, "request_mail_commit", &bad, nil, nil}, now); err == nil {
				t.Fatal("grant substitution", change)
			}
		}
		pending := path(t, 3)
		for _, change := range []string{"scope", "generation", "hash", "receipt", "kind", "state", "store"} {
			bad := p
			switch change {
			case "scope":
				bad.Scope.Mailbox = uuid()
			case "generation":
				bad.Receipt.Raw.Generation++
			case "hash":
				bad.Receipt.Raw.SHA256 = strings.Repeat("c", 64)
			case "receipt":
				bad.Receipt.ID = ""
			case "kind":
				bad.Kind = "repository_artifact_bytes_verified"
			case "state":
				bad.SecurityState = "clean"
			case "store":
				bad.ObjectStoreRef = "gcs:unrelated"
			}
			if _, err := AdvanceMailCommit(pending, MailCommitEvent{uuid(), pending.Revision, "mail_commit_observed", nil, &bad, nil}, now); err == nil {
				t.Fatal("proof substitution", change)
			}
		}
		event := MailCommitEvent{uuid(), prepared.Revision, "request_mail_commit", &g, nil, nil}
		out, err := AdvanceMailCommit(prepared, event, now)
		if err != nil {
			t.Fatal(err)
		}
		event.Kind = "request_seal"
		if _, err = AdvanceMailCommit(out.Snapshot, event, now); err == nil {
			t.Fatal("changed replay")
		}
		event.ID = uuid()
		event.Kind = "mail_commit_observed"
		event.Proof = &p
		if _, err = AdvanceMailCommit(out.Snapshot, event, now); err == nil {
			t.Fatal("stale revision")
		}
	})
	t.Run("expiry_and_fence_loss_are_not_misreported_as_revocation", func(t *testing.T) {
		for _, kind := range []string{"expiry_observed", "fence_lost_observed"} {
			s := path(t, 4)
			s = apply(t, s, kind, nil, nil, nil)
			if s.State != "REFUSED_PRIVATE" || s.RevocationObserved || s.AuthorityRefusal != kind || s.Proof == nil {
				t.Fatal("incorrect authority refusal")
			}
		}
	})
	t.Run("runtime_proof_is_exact_minimal_reference_not_mailbox_copy", func(t *testing.T) {
		proof, err := RuntimeMailSealProof(b, p)
		if err != nil {
			t.Fatal(err)
		}
		var fields map[string]any
		if err = json.Unmarshal(encoded(proof), &fields); err != nil {
			t.Fatal(err)
		}
		if len(fields) != 10 || proof.MailProofSHA256 != digest(encoded(p)) || proof.MailReceiptID != p.Receipt.ID || strings.Contains(string(encoded(proof)), b.Raw.Key) {
			t.Fatal("wrong Runtime proof schema")
		}
	})
	t.Run("input_pointers_cannot_change_saved_proof", func(t *testing.T) {
		s := path(t, 3)
		copyProof := p
		event := MailCommitEvent{uuid(), s.Revision, "mail_commit_observed", nil, &copyProof, nil}
		out, err := AdvanceMailCommit(s, event, now)
		if err != nil {
			t.Fatal(err)
		}
		copyProof.Receipt.ID = uuid()
		if out.Snapshot.Proof.Receipt.ID != p.Receipt.ID {
			t.Fatal("caller mutated saved proof")
		}
	})
}

func exerciseMailCommitProof(t *testing.T, s *Service, admin *pgx.Conn, ctx context.Context) {
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	b, g, _, now := syntheticProtocolFixture()
	_, err := admin.Exec(ctx, `INSERT INTO core.tenants(tenant_id,region) VALUES($1,'local-custody-proposal')`, b.Scope.Tenant)
	must(err)
	_, err = admin.Exec(ctx, `INSERT INTO core.mail_accounts VALUES($1,$2,'hosted','synthetic')`, b.Scope.Tenant, b.Scope.Account)
	must(err)
	_, err = admin.Exec(ctx, `INSERT INTO core.mailboxes VALUES($1,$2,$3,'Synthetic custody proposal')`, b.Scope.Tenant, b.Scope.Account, b.Scope.Mailbox)
	must(err)
	request := Request{Scope: b.Scope, DeliveryID: b.DeliveryID, Source: "synthetic-custody-proof", Envelope: Envelope{From: "sender@example.invalid", To: []string{"recipient@example.invalid"}, ReceivedAt: now}, Raw: SyntheticFixture}
	r, err := s.Ingest(ctx, request)
	must(err)
	b.Raw = r.Raw
	must(admin.QueryRow(ctx, `SELECT input_sha256 FROM core.ingestions WHERE delivery_id=$1`, b.DeliveryID).Scan(&b.MailInputSHA256))
	p, err := s.ReadMailCommitProof(ctx, b)
	must(err)
	if p.Receipt.ID != r.ID || p.Receipt.AttachmentCount != 1 || p.SecurityState != "quarantined" {
		t.Fatal("incorrect durable proof")
	}
	again, err := s.ReadMailCommitProof(ctx, b)
	must(err)
	if !bytes.Equal(encoded(p), encoded(again)) {
		t.Fatal("proof not stable")
	}
	bad := b
	bad.Scope.Mailbox = uuid()
	bad.Raw.Key = draftPrefix(bad.Scope) + "other.eml"
	if _, err = s.ReadMailCommitProof(ctx, bad); err == nil {
		t.Fatal("foreign proof lookup")
	}
	bad = b
	bad.Raw.Generation++
	if _, err = s.ReadMailCommitProof(ctx, bad); err == nil {
		t.Fatal("wrong generation")
	}
	bad = b
	bad.MailInputSHA256 = strings.Repeat("c", 64)
	if _, err = s.ReadMailCommitProof(ctx, bad); err == nil {
		t.Fatal("wrong semantic input")
	}
	broken := *s
	broken.Objects = unavailableExportObject{ObjectStore: s.Objects, key: p.Attachments[0].Key, failure: ErrObjectNotFound}
	if _, err = broken.ReadMailCommitProof(ctx, b); err == nil {
		t.Fatal("unverified provider adapter accepted")
	}
	plan, err := NewMailCommitPlan(b)
	must(err)
	step := func(kind string, proof *MailCommitProof, canonical *MailCanonicalStatus) {
		event := MailCommitEvent{uuid(), plan.Revision, kind, &g, proof, canonical}
		out, err := AdvanceMailCommit(plan, event, now)
		must(err)
		must(json.Unmarshal(encoded(out.Snapshot), &plan))
	}
	step("request_claim", nil, nil)
	step("claim_observed", nil, nil)
	step("request_mail_commit", nil, nil)
	step("mail_commit_observed", &p, nil)
	step("request_seal", nil, nil)
	step("outcome_unknown", nil, nil)
	// Modeled canonical status, not a signed Runtime/scanner/provider acceptance.
	status := MailCanonicalStatus{"SEALED", b.ArtifactID, b.CanonicalBindingSHA256, digest(encoded(p))}
	step("reconcile_observed", &p, &status)
	step("revocation_observed", nil, nil)
	if path := os.Getenv("MAIL_TEST_CUSTODY_EVIDENCE"); path != "" {
		must(os.WriteFile(path, encoded(map[string]any{"source_revision": os.Getenv("MAIL_TEST_SOURCE_REV"), "local_postgres_proof": p, "modeled_runtime_snapshot": plan, "canonical_runtime_adapter_installed": false, "independent_acceptance": false, "cloud_deployed": false}), 0600))
	}
}
