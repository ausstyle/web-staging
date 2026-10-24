package mailstore

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func exerciseCollectionPortability(t *testing.T, s *Service, admin *pgx.Conn, ctx context.Context) {
	must := func(e error) {
		t.Helper()
		if e != nil {
			t.Fatal(e)
		}
	}
	fresh := func() Scope {
		sc := Scope{uuid(), uuid(), uuid()}
		_, e := admin.Exec(ctx, `INSERT INTO core.tenants(tenant_id,region) VALUES($1,'local-hierarchy')`, sc.Tenant)
		must(e)
		_, e = admin.Exec(ctx, `INSERT INTO core.mail_accounts VALUES($1,$2,'hosted','synthetic')`, sc.Tenant, sc.Account)
		must(e)
		_, e = admin.Exec(ctx, `INSERT INTO core.mailboxes VALUES($1,$2,$3,'Synthetic hierarchy')`, sc.Tenant, sc.Account, sc.Mailbox)
		must(e)
		return sc
	}
	who := func() EditIdentity { return EditIdentity{"synthetic-hierarchy", uuid()} }
	add := func(sc Scope, name, kind string, parent *string) string {
		id := uuid()
		_, e := s.CreateCollectionUnder(ctx, sc, who(), CollectionInput{id, kind, name}, parent)
		must(e)
		return id
	}
	source := fresh()
	root := add(source, "Projects", "folder", nil)
	child := add(source, "2026", "folder", &root)
	_ = add(source, "Empty 日本語", "folder", &child)
	archiveRoot := add(source, "Archive", "folder", nil)
	_ = add(source, "2026", "folder", &archiveRoot)
	_ = add(source, "Unused label", "label", nil)
	label := add(source, "Review", "label", nil)
	originals, e := s.ListCollections(ctx, source)
	must(e)
	message, e := s.Ingest(ctx, Request{Scope: source, DeliveryID: uuid(), Source: "synthetic-hierarchy", Raw: SyntheticFixture, Envelope: Envelope{From: "sender@example.invalid", To: []string{"receiver@example.invalid"}, ReceivedAt: time.Now().UTC().Truncate(time.Microsecond)}})
	must(e)
	_, e = s.OrganizeMessage(ctx, source, who(), OrganizationInput{message.MessageID, 0, &child, []string{label}})
	must(e)
	var output bytes.Buffer
	manifest, e := s.ExportMailbox(ctx, source, &output, 100)
	must(e)
	if manifest.Version != 3 || len(manifest.Messages) != 2 || manifest.Messages[0].Collections == nil || len(manifest.Messages[0].Collections.Collections) != 7 {
		t.Fatal("empty collection inventory missing")
	}
	stage := func(dest Scope, raw []byte, create bool, mapping map[string]string) ImportJob {
		spec := ImportSpec{Key: uuid(), Format: "eml-tar", SourceSHA256: digest(raw), SourceSize: int64(len(raw)), Folder: "Portable", Cutoff: time.Now().UTC(), AdmissionRef: "synthetic-hierarchy", RestoreCollections: create, CollectionMap: mapping}
		j, e := s.StageImport(ctx, dest, spec, bytes.NewReader(raw))
		must(e)
		return j
	}
	finish := func(dest Scope, j ImportJob) ImportJob {
		for n := 0; n < 30 && j.State != "COMPLETE" && j.State != "COMPLETED_WITH_EXCEPTIONS" && j.State != "NEEDS_ACTION"; n++ {
			j, e = s.ResumeImport(ctx, dest, j.Spec.Key, 1)
			must(e)
		}
		return j
	}
	verify := func(dest Scope, j ImportJob) {
		rows, e := s.ListCollections(ctx, dest)
		must(e)
		if len(rows) != len(originals) {
			t.Fatal("empty nodes lost", rows)
		}
		actual := map[string]Collection{}
		for _, c := range rows {
			actual[c.CollectionID] = c
		}
		for _, c := range originals {
			id := portableID("collection:" + j.ID + ":" + c.CollectionID)
			d, ok := actual[id]
			if !ok || d.Name != c.Name || d.Kind != c.Kind || (d.ParentID == nil) != (c.ParentID == nil) {
				t.Fatal("tree changed")
			}
			if c.ParentID != nil && *d.ParentID != portableID("collection:"+j.ID+":"+*c.ParentID) {
				t.Fatal("parent lost")
			}
		}
		report, e := s.ImportReport(ctx, dest, j.Spec.Key)
		must(e)
		if report.State != "COMPLETE" || report.ExpectedCollections != 7 || report.VerifiedCollections != 7 || report.UnverifiedCollections != 0 {
			t.Fatal(report)
		}
		var count int
		must(admin.QueryRow(ctx, `SELECT count(*) FROM core.mail_edit_receipts WHERE mailbox_id=$1 AND operation='mail.collections.restore'`, dest.Mailbox).Scan(&count))
		if count != 1 {
			t.Fatal("duplicate collection receipt")
		}
	}
	t.Run("parents_scope_sibling_names_and_receipt_binding", func(t *testing.T) {
		_, e = s.CreateCollectionUnder(ctx, source, who(), CollectionInput{uuid(), "folder", "2026"}, &root)
		if !errors.Is(e, ErrEditConflict) {
			t.Fatal("duplicate sibling accepted", e)
		}
		_, e = s.CreateCollectionUnder(ctx, fresh(), who(), CollectionInput{uuid(), "folder", "Foreign parent"}, &root)
		if !errors.Is(e, ErrNotFound) {
			t.Fatal("parent crossed tenant", e)
		}
		_, e = s.CreateCollectionUnder(ctx, source, who(), CollectionInput{uuid(), "folder", "Label parent"}, &label)
		if !errors.Is(e, ErrEditInvalid) {
			t.Fatal("label became parent", e)
		}
		sc := fresh()
		p := add(sc, "Parent", "folder", nil)
		in := CollectionInput{uuid(), "folder", "Replay"}
		identity := who()
		a, e := s.CreateCollectionUnder(ctx, sc, identity, in, &p)
		must(e)
		b, e := s.CreateCollectionUnder(ctx, sc, identity, in, &p)
		must(e)
		if a != b {
			t.Fatal("receipt changed")
		}
		if _, e = s.CreateCollectionUnder(ctx, sc, identity, in, nil); !errors.Is(e, ErrEditConflict) {
			t.Fatal("parent changed under same key")
		}
	})
	for _, fault := range []string{"import_after_collection_insert", "edit_after_commit", "import_after_collection_restore", "import_before_item_commit", "import_after_item_commit"} {
		t.Run("interrupted_tree_"+fault, func(t *testing.T) {
			dest := fresh()
			j := stage(dest, output.Bytes(), true, nil)
			for j.State == "DISCOVERING" {
				j, e = s.ResumeImport(ctx, dest, j.Spec.Key, 1)
				must(e)
			}
			faulty := *s
			faulty.fault = func(step string) error {
				if step == fault {
					return errors.New("synthetic tree interruption")
				}
				return nil
			}
			if _, e = faulty.ResumeImport(ctx, dest, j.Spec.Key, 1); e == nil {
				t.Fatal("fault missed")
			}
			if fault == "import_after_collection_insert" {
				rows, e := s.ListCollections(ctx, dest)
				must(e)
				if len(rows) != 0 {
					t.Fatal("partial tree committed")
				}
			}
			j = finish(dest, j)
			verify(dest, j)
			before, e := s.ImportReport(ctx, dest, j.Spec.Key)
			must(e)
			_, e = s.ResumeImport(ctx, dest, j.Spec.Key, 1)
			must(e)
			after, e := s.ImportReport(ctx, dest, j.Spec.Key)
			must(e)
			if string(encoded(before)) != string(encoded(after)) {
				t.Fatal("replay changed reconciliation")
			}
			var again bytes.Buffer
			exported, e := s.ExportMailbox(ctx, dest, &again, 100)
			must(e)
			if exported.Messages[1].Raw.SHA256 != message.Raw.SHA256 {
				t.Fatal("message original changed")
			}
			if fault == "import_after_collection_restore" {
				if path := os.Getenv("MAIL_TEST_HIERARCHY_EVIDENCE"); path != "" {
					b, e := json.MarshalIndent(map[string]any{"source_revision": os.Getenv("MAIL_TEST_SOURCE_REV"), "source_scope": source, "destination_scope": dest, "import_job": j, "report": after, "restored_export": exported, "provider_deployed": false, "independent_acceptance": false}, "", "  ")
					must(e)
					must(os.WriteFile(path, b, 0600))
				}
			}
		})
	}
	t.Run("missing_maps_loss_accounting_and_name_collision", func(t *testing.T) {
		dest := fresh()
		j := finish(dest, stage(dest, output.Bytes(), false, nil))
		report, e := s.ImportReport(ctx, dest, j.Spec.Key)
		must(e)
		if j.State != "COMPLETED_WITH_EXCEPTIONS" || report.VerifiedCollections != 0 || report.UnverifiedCollections != 7 || report.Exceptions != 2 {
			t.Fatal(report)
		}
		rows, e := s.ListCollections(ctx, dest)
		must(e)
		if len(rows) != 0 {
			t.Fatal("implicit creation")
		}
		collision := fresh()
		_ = add(collision, "Projects", "folder", nil)
		j = stage(collision, output.Bytes(), true, nil)
		for j.State == "DISCOVERING" {
			j, e = s.ResumeImport(ctx, collision, j.Spec.Key, 1)
			must(e)
		}
		if _, e = s.ResumeImport(ctx, collision, j.Spec.Key, 1); !errors.Is(e, ErrEditConflict) {
			t.Fatal("collision overwritten", e)
		}
		rows, e = s.ListCollections(ctx, collision)
		must(e)
		if len(rows) != 1 || rows[0].Name != "Projects" {
			t.Fatal("collision left partial tree")
		}
	})

	t.Run("wrong_parent_map_and_corrupt_inventory_need_action", func(t *testing.T) {
		dest := fresh()
		mapping := map[string]string{}
		ordered, err := orderedCollections(CollectionInventory{1, originals})
		must(err)
		for _, c := range ordered {
			var parent *string
			if c.ParentID != nil {
				p := mapping[*c.ParentID]
				parent = &p
			}
			if c.CollectionID == child {
				parent = nil
			}
			mapping[c.CollectionID] = add(dest, c.Name, c.Kind, parent)
		}
		j := stage(dest, output.Bytes(), false, mapping)
		for j.State == "DISCOVERING" {
			j, e = s.ResumeImport(ctx, dest, j.Spec.Key, 1)
			must(e)
		}
		if _, e = s.ResumeImport(ctx, dest, j.Spec.Key, 1); e == nil {
			t.Fatal("wrong parent mapping accepted")
		}
		var state string
		must(admin.QueryRow(ctx, `SELECT state FROM core.mail_import_jobs WHERE job_id=$1`, j.ID).Scan(&state))
		if state != "NEEDS_ACTION" {
			t.Fatal(state)
		}
		bad := CollectionInventory{1, []Collection{{CollectionID: root, Kind: "folder", Name: "Cycle", ParentID: &root}}}
		raw := encoded(bad)
		m := ExportManifest{Version: 3, Complete: true, Messages: []ExportItem{{Path: "collections.json", Collections: &bad, Raw: Object{SHA256: digest(raw), Size: int64(len(raw))}}}}
		data := testTAR(t, []string{"collections.json", "manifest.json"}, [][]byte{raw, encoded(m)})
		sc := fresh()
		badJob := finish(sc, stage(sc, data, true, nil))
		if badJob.State != "NEEDS_ACTION" {
			t.Fatal("cyclic source accepted")
		}
		rows, err := s.ListCollections(ctx, sc)
		must(err)
		if len(rows) != 0 {
			t.Fatal("cyclic source wrote collections")
		}
	})
	t.Run("empty_only_mailbox_and_resumable_frozen_inventory", func(t *testing.T) {
		empty := fresh()
		p := add(empty, "Empty root", "folder", nil)
		_ = add(empty, "Empty child", "folder", &p)
		_ = add(empty, "Empty label", "label", nil)
		auth := &syntheticExportAuthority{scope: empty}
		spec := ExportSpec{Key: uuid(), AdmissionRef: "synthetic-local-export-test", ExpiresAt: time.Now().Add(time.Hour), PartitionMessages: 1, ExceptionPolicy: "stop"}
		job, e := s.CreateExport(ctx, empty, spec, auth)
		must(e)
		_ = add(empty, "Added later", "folder", nil)
		faulty := *s
		faulty.fault = func(step string) error {
			if step == "export_before_checkpoint_commit" {
				return errors.New("synthetic export stop")
			}
			return nil
		}
		if _, e = faulty.ResumeExport(ctx, empty, spec.Key, auth); e == nil {
			t.Fatal("export fault missed")
		}
		for n := 0; n < 10 && job.State != "COMPLETE"; n++ {
			job, e = s.ResumeExport(ctx, empty, spec.Key, auth)
			must(e)
		}
		report, e := s.ReadExportReport(ctx, empty, spec.Key, auth)
		must(e)
		if report.Expected != 1 || report.ExportedCollections != 3 || report.PartCount != 1 || report.Version != 3 {
			t.Fatal(report)
		}
		var part bytes.Buffer
		_, e = s.ReadExportPart(ctx, empty, spec.Key, 1, 0, &part, auth)
		must(e)
		dest := fresh()
		j := finish(dest, stage(dest, part.Bytes(), true, nil))
		if j.State != "COMPLETE" {
			t.Fatal(j.State)
		}
		rows, e := s.ListCollections(ctx, dest)
		must(e)
		if len(rows) != 3 {
			t.Fatal("empty snapshot not frozen")
		}
	})
	t.Run("split_export_inventory_then_explicitly_mapped_message_part", func(t *testing.T) {
		auth := &syntheticExportAuthority{scope: source}
		spec := ExportSpec{Key: uuid(), AdmissionRef: "synthetic-local-export-test", ExpiresAt: time.Now().Add(time.Hour), PartitionMessages: 1, ExceptionPolicy: "stop"}
		job, e := s.CreateExport(ctx, source, spec, auth)
		must(e)
		for n := 0; n < 12 && job.State != "COMPLETE"; n++ {
			job, e = s.ResumeExport(ctx, source, spec.Key, auth)
			must(e)
		}
		dest := fresh()
		var first bytes.Buffer
		_, e = s.ReadExportPart(ctx, source, spec.Key, 1, 0, &first, auth)
		must(e)
		j := finish(dest, stage(dest, first.Bytes(), true, nil))
		verify(dest, j)
		mapping := map[string]string{}
		for _, c := range originals {
			mapping[c.CollectionID] = portableID("collection:" + j.ID + ":" + c.CollectionID)
		}
		var second bytes.Buffer
		_, e = s.ReadExportPart(ctx, source, spec.Key, 2, 0, &second, auth)
		must(e)
		next := finish(dest, stage(dest, second.Bytes(), false, mapping))
		if next.State != "COMPLETE" {
			t.Fatal(next.State)
		}
		messages, e := s.ListOrganized(ctx, dest, "", nil, 10, mapping[child], mapping[label])
		must(e)
		if len(messages) != 1 {
			t.Fatal("split part mapping lost")
		}
	})
}

func TestCollectionGraphValidation(t *testing.T) {
	root, child := uuid(), uuid()
	valid := CollectionInventory{1, []Collection{{CollectionID: root, Kind: "folder", Name: "Root"}, {CollectionID: child, Kind: "folder", Name: "Child", ParentID: &root}}}
	if _, e := orderedCollections(valid); e != nil {
		t.Fatal(e)
	}
	for _, name := range []string{"cycle", "missing_parent", "label_parent", "duplicate_id", "duplicate_sibling", "label_with_parent"} {
		t.Run(name, func(t *testing.T) {
			var v CollectionInventory
			_ = json.Unmarshal(encoded(valid), &v)
			switch name {
			case "cycle":
				v.Collections[0].ParentID = &child
			case "missing_parent":
				id := uuid()
				v.Collections[1].ParentID = &id
			case "label_parent":
				v.Collections[0].Kind = "label"
			case "duplicate_id":
				v.Collections = append(v.Collections, v.Collections[0])
			case "duplicate_sibling":
				c := v.Collections[1]
				c.CollectionID = uuid()
				c.Name = "child"
				v.Collections = append(v.Collections, c)
			case "label_with_parent":
				v.Collections[1].Kind = "label"
			}
			if _, e := orderedCollections(v); e == nil {
				t.Fatal("invalid graph accepted")
			}
			raw := encoded(v)
			manifest := ExportManifest{Version: 3, Complete: true, Messages: []ExportItem{{Path: "collections.json", Collections: &v, Raw: Object{SHA256: digest(raw), Size: int64(len(raw))}}}}
			archive := testTAR(t, []string{"collections.json", "manifest.json"}, [][]byte{raw, encoded(manifest)})
			p, e := InspectTAR(bytes.NewReader(archive), nil)
			if e == nil && p.State == "READY" {
				t.Fatal("invalid archive graph accepted")
			}
		})
	}
}
