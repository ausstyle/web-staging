package mailstore

// Source-only Mail effect protocol. This reducer is NOT an authority adapter,
// scanner verifier, scheduler or permission to execute an action. Its snapshot
// and returned transition must be persisted atomically in the EXISTING Runtime
// mission step journal BEFORE the owner executes NextAction. No live adapter is
// registered. Evidence events may come only from installed canonical owner
// adapters, never HTTP arguments or MIME headers. See custody-protocol.md.
import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"
)

var ErrMailProtocol = errors.New("invalid_mail_commit_protocol_transition")

const MailQuarantineProofKind = "mail_quarantined_ingest_committed"

type MailCommitBinding struct {
	ObjectStoreRef         string `json:"object_store_ref"`
	EffectID               string `json:"effect_id"`
	Scope                  Scope  `json:"scope"`
	DeliveryID             string `json:"delivery_id"`
	MailInputSHA256        string `json:"mail_input_sha256"`
	Raw                    Object `json:"raw"`
	AdmissionID            string `json:"admission_id"`
	ArtifactID             string `json:"artifact_id"`
	FileID                 string `json:"file_id"`
	ScanReceiptID          string `json:"scan_receipt_id"`
	CanonicalBindingSHA256 string `json:"canonical_binding_sha256"`
	RuntimeFenceRef        string `json:"runtime_fence_ref"`
}

func (b MailCommitBinding) valid() bool {
	return (b.ObjectStoreRef == "local-fixture" || (strings.HasPrefix(b.ObjectStoreRef, "gcs:") && len(b.ObjectStoreRef) > 4 && len(b.ObjectStoreRef) < 205)) && idPattern.MatchString(b.EffectID) && b.Scope.valid() && len(b.DeliveryID) > 0 && len(b.DeliveryID) <= 200 && validSHA256(b.MailInputSHA256) && validDraftObject(b.Scope, b.Raw) && validSHA256(b.Raw.SHA256) && idPattern.MatchString(b.AdmissionID) && idPattern.MatchString(b.ArtifactID) && idPattern.MatchString(b.FileID) && idPattern.MatchString(b.ScanReceiptID) && validSHA256(b.CanonicalBindingSHA256) && len(b.RuntimeFenceRef) > 0 && len(b.RuntimeFenceRef) <= 200
}

type MailCanonicalGrant struct {
	ArtifactID        string    `json:"artifact_id"`
	BindingSHA256     string    `json:"binding_sha256"`
	AuthorityRevision string    `json:"authority_revision"`
	RuntimeFenceRef   string    `json:"runtime_fence_ref"`
	ExpiresAt         time.Time `json:"expires_at"`
	// Lease token is deliberately absent: existing Runtime executor keeps it
	// private. A restored JSON snapshot cannot mint/recover a lost capability.
}

func (g MailCanonicalGrant) matches(b MailCommitBinding, now time.Time) bool {
	return g.ArtifactID == b.ArtifactID && g.BindingSHA256 == b.CanonicalBindingSHA256 && g.RuntimeFenceRef == b.RuntimeFenceRef && len(g.AuthorityRevision) > 0 && len(g.AuthorityRevision) <= 200 && g.ExpiresAt.After(now) && !g.ExpiresAt.After(now.Add(30*time.Second))
}

type MailCommitProof struct {
	ObjectStoreRef  string   `json:"object_store_ref"`
	Version         int      `json:"version"`
	Kind            string   `json:"kind"`
	EffectID        string   `json:"effect_id"`
	BindingSHA256   string   `json:"binding_sha256"`
	Scope           Scope    `json:"scope"`
	MailInputSHA256 string   `json:"mail_input_sha256"`
	Receipt         Receipt  `json:"receipt"`
	Attachments     []Object `json:"attachments"`
	SecurityState   string   `json:"security_state"`
}

func (p MailCommitProof) matches(b MailCommitBinding) bool {
	if p.ObjectStoreRef != b.ObjectStoreRef || p.Version != 1 || p.Kind != MailQuarantineProofKind || p.EffectID != b.EffectID || p.BindingSHA256 != b.CanonicalBindingSHA256 || p.Scope != b.Scope || p.MailInputSHA256 != b.MailInputSHA256 || p.Receipt.Raw != b.Raw || p.Receipt.DeliveryID != b.DeliveryID || !idPattern.MatchString(p.Receipt.ID) || !idPattern.MatchString(p.Receipt.MessageID) || p.Receipt.ObservedAt.IsZero() || p.Receipt.Release == "" || !validDraftObject(b.Scope, p.Receipt.Ledger) || !validSHA256(p.Receipt.Ledger.SHA256) || p.Receipt.AttachmentCount != len(p.Attachments) || p.SecurityState != "quarantined" {
		return false
	}
	for _, a := range p.Attachments {
		if !(strings.HasPrefix(a.Key, draftPrefix(b.Scope)) && validKey(a.Key) && a.Generation > 0 && a.Size >= 0 && a.Size <= MaxMessageBytes) || !validSHA256(a.SHA256) {
			return false
		}
	}
	return true
}

// ReadMailCommitProof only observes an existing commit; it never calls Recover or
// Ingest. Absence is NOT proof that a previously started writer cannot commit.
func (s *Service) ReadMailCommitProof(ctx context.Context, b MailCommitBinding) (MailCommitProof, error) {
	if !b.valid() {
		return MailCommitProof{}, ErrMailProtocol
	}
	switch store := s.Objects.(type) {
	case LocalStore:
		if b.ObjectStoreRef != "local-fixture" {
			return MailCommitProof{}, ErrIntegrity
		}
	case GCSStore:
		if b.ObjectStoreRef != "gcs:"+store.Bucket {
			return MailCommitProof{}, ErrIntegrity
		}
	default:
		return MailCommitProof{}, ErrIntegrity
	}
	m, _, err := s.Retrieve(ctx, b.Scope, b.DeliveryID)
	if err != nil {
		return MailCommitProof{}, err
	}
	c, err := s.connection(ctx)
	if err != nil {
		return MailCommitProof{}, err
	}
	defer c.Release()
	tx, err := scopedTx(ctx, c, b.Scope)
	if err != nil {
		return MailCommitProof{}, err
	}
	defer tx.Rollback(ctx)
	var input, state string
	if err = tx.QueryRow(ctx, `SELECT input_sha256,state FROM core.ingestions WHERE delivery_id=$1`, b.DeliveryID).Scan(&input, &state); err != nil {
		return MailCommitProof{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MailCommitProof{}, err
	}
	p := MailCommitProof{b.ObjectStoreRef, 1, MailQuarantineProofKind, b.EffectID, b.CanonicalBindingSHA256, b.Scope, input, m.Receipt, m.Attachments, m.SecurityState}
	if state != "complete" || !p.matches(b) {
		return MailCommitProof{}, ErrIntegrity
	}
	if _, err = s.Objects.Get(ctx, p.Receipt.Ledger); err != nil {
		return MailCommitProof{}, err
	}
	for _, a := range p.Attachments {
		if _, err = s.Objects.Get(ctx, a); err != nil {
			return MailCommitProof{}, err
		}
	}
	return p, nil
}

// Proposed exact ten-field Runtime proof discriminator. The full Mail-domain
// proof stays with Mail; Runtime stores only these audit references and digest.
type MailRuntimeSealProof struct {
	Version         int    `json:"version"`
	Kind            string `json:"kind"`
	ArtifactID      string `json:"artifactId"`
	Generation      string `json:"generation"`
	Size            int64  `json:"size"`
	SHA256          string `json:"sha256"`
	BindingSHA256   string `json:"bindingSha256"`
	EffectID        string `json:"effectId"`
	MailReceiptID   string `json:"mailReceiptId"`
	MailProofSHA256 string `json:"mailProofSha256"`
}

func RuntimeMailSealProof(b MailCommitBinding, p MailCommitProof) (MailRuntimeSealProof, error) {
	if !b.valid() || !p.matches(b) {
		return MailRuntimeSealProof{}, ErrMailProtocol
	}
	return MailRuntimeSealProof{1, MailQuarantineProofKind, b.ArtifactID, strconv.FormatInt(b.Raw.Generation, 10), b.Raw.Size, b.Raw.SHA256, b.CanonicalBindingSHA256, b.EffectID, p.Receipt.ID, digest(encoded(p))}, nil
}

type MailCanonicalStatus struct {
	State           string `json:"state"` // SEALED, ABANDONED, RECONCILIATION_REQUIRED
	ArtifactID      string `json:"artifact_id"`
	BindingSHA256   string `json:"binding_sha256"`
	MailProofSHA256 string `json:"mail_proof_sha256"`
	// Status carries no bytes, private handle, lease, renewed grant or permission.
}
type MailCommitSnapshot struct {
	AuthorityRefusal   string               `json:"authority_refusal,omitempty"`
	Version            int                  `json:"version"`
	Revision           int64                `json:"revision"`
	Binding            MailCommitBinding    `json:"binding"`
	State              string               `json:"state"`
	UncertainStage     string               `json:"uncertain_stage,omitempty"`
	Grant              *MailCanonicalGrant  `json:"grant,omitempty"`
	Proof              *MailCommitProof     `json:"proof,omitempty"`
	Canonical          *MailCanonicalStatus `json:"canonical,omitempty"`
	RevocationObserved bool                 `json:"revocation_observed"`
	Events             map[string]string    `json:"events"`
}
type MailCommitEvent struct {
	ID               string               `json:"id"`
	ExpectedRevision int64                `json:"expected_revision"`
	Kind             string               `json:"kind"`
	Grant            *MailCanonicalGrant  `json:"grant,omitempty"`
	Proof            *MailCommitProof     `json:"proof,omitempty"`
	Canonical        *MailCanonicalStatus `json:"canonical,omitempty"`
}
type MailCommitTransition struct {
	Snapshot   MailCommitSnapshot `json:"snapshot"`
	NextAction string             `json:"next_action"`
	// Every result is a PRIVATE historical effect. Never authorizes access/send.
}

func NewMailCommitPlan(b MailCommitBinding) (MailCommitSnapshot, error) {
	if !b.valid() {
		return MailCommitSnapshot{}, ErrMailProtocol
	}
	return MailCommitSnapshot{Version: 1, Binding: b, State: "STAGED_PRIVATE", Events: map[string]string{}}, nil
}
func (s MailCommitSnapshot) PermitsCustomerAccess() bool { return false }
func AdvanceMailCommit(current MailCommitSnapshot, e MailCommitEvent, now time.Time) (MailCommitTransition, error) {
	fail := func() (MailCommitTransition, error) { return MailCommitTransition{}, ErrMailProtocol }
	if current.Version != 1 || !current.Binding.valid() || current.Events == nil || !idPattern.MatchString(e.ID) || now.IsZero() {
		return fail()
	}
	// Copy through JSON: caller changes cannot mutate a journal snapshot or proof.
	var s MailCommitSnapshot
	if json.Unmarshal(encoded(current), &s) != nil {
		return fail()
	}
	var eventCopy MailCommitEvent
	if json.Unmarshal(encoded(e), &eventCopy) != nil {
		return fail()
	}
	e = eventCopy
	hash := digest(encoded(e))
	if old, ok := s.Events[e.ID]; ok {
		if old != hash {
			return fail()
		}
		return MailCommitTransition{s, "NONE"}, nil
	}
	if e.ExpectedRevision != s.Revision || len(s.Events) >= 128 {
		return fail()
	}
	next := "NONE"
	grantOK := func() bool {
		return e.Grant != nil && s.Grant != nil && e.Grant.matches(s.Binding, now) && bytes.Equal(encoded(e.Grant), encoded(s.Grant)) && !s.RevocationObserved && s.AuthorityRefusal == ""
	}
	proofOK := func() bool { return e.Proof != nil && e.Proof.matches(s.Binding) }
	canonicalOK := func() bool {
		return e.Canonical != nil && e.Canonical.ArtifactID == s.Binding.ArtifactID && e.Canonical.BindingSHA256 == s.Binding.CanonicalBindingSHA256
	}
	switch e.Kind {
	case "request_claim":
		if s.State != "STAGED_PRIVATE" || s.RevocationObserved || s.AuthorityRefusal != "" {
			return fail()
		}
		s.State = "CLAIM_PENDING"
		next = "CANONICAL_ACQUIRE_ONCE"
	case "claim_observed":
		if s.State != "CLAIM_PENDING" || e.Grant == nil || !e.Grant.matches(s.Binding, now) || s.RevocationObserved || s.AuthorityRefusal != "" {
			return fail()
		}
		s.Grant = e.Grant
		s.State = "PREPARED_PRIVATE"
	case "request_mail_commit":
		if s.State != "PREPARED_PRIVATE" || !grantOK() {
			return fail()
		}
		s.State = "MAIL_PENDING"
		next = "COMMIT_QUARANTINED_MAIL_ONCE"
	case "mail_commit_observed":
		if s.State != "MAIL_PENDING" || !proofOK() {
			return fail()
		}
		s.Proof = e.Proof
		s.State = "MAIL_COMMITTED_PRIVATE"
	case "request_seal":
		if s.State != "MAIL_COMMITTED_PRIVATE" || s.Proof == nil || !grantOK() {
			return fail()
		}
		s.State = "SEAL_PENDING"
		next = "CANONICAL_MAIL_SEAL_ONCE"
	case "seal_observed":
		if s.State != "SEAL_PENDING" || !canonicalOK() || e.Canonical.State != "SEALED" || s.Proof == nil || e.Canonical.MailProofSHA256 != digest(encoded(s.Proof)) {
			return fail()
		}
		s.Canonical = e.Canonical
		s.State = "SEALED_PRIVATE"
	case "outcome_unknown":
		if s.State != "CLAIM_PENDING" && s.State != "MAIL_PENDING" && s.State != "SEAL_PENDING" {
			return fail()
		}
		s.UncertainStage = s.State
		s.State = "RECONCILIATION_REQUIRED"
		next = "READ_CANONICAL_STATUS_AND_MAIL_RECEIPT"
	case "revocation_observed", "expiry_observed", "fence_lost_observed":
		s.AuthorityRefusal = e.Kind
		if e.Kind == "revocation_observed" {
			s.RevocationObserved = true
		}
		switch s.State {
		case "STAGED_PRIVATE", "PREPARED_PRIVATE", "MAIL_COMMITTED_PRIVATE":
			s.State = "REFUSED_PRIVATE"
		case "CLAIM_PENDING", "MAIL_PENDING", "SEAL_PENDING":
			s.UncertainStage = s.State
			s.State = "RECONCILIATION_REQUIRED"
			next = "READ_CANONICAL_STATUS_AND_MAIL_RECEIPT"
		case "RECONCILIATION_REQUIRED":
			next = "READ_CANONICAL_STATUS_AND_MAIL_RECEIPT"
		case "SEALED_PRIVATE", "REFUSED_PRIVATE": // preserve historical receipt
		default:
			return fail()
		}
	case "reconcile_observed":
		if s.State != "RECONCILIATION_REQUIRED" || !canonicalOK() {
			return fail()
		}
		if e.Proof != nil {
			if !proofOK() || (s.Proof != nil && !bytes.Equal(encoded(s.Proof), encoded(e.Proof))) {
				return fail()
			}
			s.Proof = e.Proof
		}
		switch e.Canonical.State {
		case "SEALED":
			if s.Proof == nil || e.Canonical.MailProofSHA256 != digest(encoded(s.Proof)) {
				return fail()
			}
			s.Canonical = e.Canonical
			s.State = "SEALED_PRIVATE"
			s.UncertainStage = ""
		case "ABANDONED":
			s.Canonical = e.Canonical
			// A missing Mail receipt is not a fenced negative result. Keep uncertainty
			// if a Mail writer could still be running. Never retry it or erase audit.
			if s.UncertainStage != "MAIL_PENDING" || s.Proof != nil {
				s.State = "REFUSED_PRIVATE"
				s.UncertainStage = ""
			} else {
				next = "READ_CANONICAL_STATUS_AND_MAIL_RECEIPT"
			}
		case "RECONCILIATION_REQUIRED":
			next = "READ_CANONICAL_STATUS_AND_MAIL_RECEIPT"
		default:
			return fail()
		}
	default:
		return fail()
	}
	s.Events[e.ID] = hash
	s.Revision++
	// Invariants also apply when deserializing historical intermediate snapshots.
	if s.Proof != nil && !s.Proof.matches(s.Binding) {
		return fail()
	}
	if s.State == "SEALED_PRIVATE" && (s.Proof == nil || s.Canonical == nil || s.Canonical.State != "SEALED" || s.Canonical.MailProofSHA256 != digest(encoded(s.Proof))) {
		return fail()
	}
	return MailCommitTransition{s, next}, nil
}
