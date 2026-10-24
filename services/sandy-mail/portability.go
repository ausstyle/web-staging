package mailstore

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/mail"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// Version 2 portable archives carry draft JSON as explicitly typed records.
// Version 2 manifests distinguish drafts; record counters include both kinds.
// Draft IDs/timestamps/revisions in the immutable master remain provenance;
// destination IDs are derived from the admitted job and path, never source IDs.
func validPortableDraft(d Draft) bool {
	if !idPattern.MatchString(d.DraftID) || d.Version < 1 || d.Version > 1<<50 || d.UpdatedAt.IsZero() || d.CreatedAt.IsZero() || d.UpdatedAt.Before(d.CreatedAt) || len(d.Subject) > 998 || strings.ContainsAny(d.Subject, "\r\n\x00") || len(d.Text) > 65536 || strings.ContainsRune(d.Text, 0) || !utf8.ValidString(d.Subject) || !utf8.ValidString(d.Text) || d.To == nil || len(d.To) > 50 {
		return false
	}
	for _, a := range d.To {
		if len(a) > 320 || strings.ContainsAny(a, "\r\n\x00") {
			return false
		}
		if _, err := mail.ParseAddress(a); err != nil {
			return false
		}
	}
	return true
}
func snapshotDrafts(ctx context.Context, tx pgx.Tx) ([]ExportItem, error) {
	rows, err := tx.Query(ctx, `SELECT draft_id::text,revision,subject,recipients,body_text,updated_at,created_at FROM core.mail_drafts ORDER BY draft_id LIMIT 1001`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ExportItem{}
	for rows.Next() {
		var d Draft
		if err = rows.Scan(&d.DraftID, &d.Version, &d.Subject, &d.To, &d.Text, &d.UpdatedAt, &d.CreatedAt); err != nil {
			return nil, err
		}
		if !validPortableDraft(d) {
			return nil, ErrIntegrity
		}
		raw := encoded(d)
		out = append(out, ExportItem{Draft: &d, MessageID: d.DraftID, Subject: d.Subject, Path: "drafts/" + d.DraftID + ".draft.json", ReceivedAt: d.UpdatedAt, Raw: Object{SHA256: digest(raw), Size: int64(len(raw))}})
	}
	if len(out) > 1000 {
		return nil, ErrEditLimit
	}
	return out, rows.Err()
}
func portableID(value string) string {
	h := digest([]byte(value))
	return h[:8] + "-" + h[8:12] + "-4" + h[13:16] + "-a" + h[17:20] + "-" + h[20:32]
}
func (i *importSession) importDraft(ctx context.Context, item importItem, count int64) error {
	raw, err := i.service.Objects.Get(ctx, item.Object)
	if err != nil {
		return err
	}
	var d Draft
	if json.Unmarshal(raw, &d) != nil || !validPortableDraft(d) {
		return ErrIntegrity
	}
	dest := portableID("draft:" + i.job.ID + ":" + item.Path)
	receipt, err := i.service.applyEdit(ctx, i.scope, EditIdentity{"import:" + i.job.ID, portableID("draft-receipt:" + item.Path)}, "mail.drafts.restore", d, func(tx pgx.Tx) (string, int64, error) {
		if err := lockEdit(ctx, tx, i.scope, "drafts"); err != nil {
			return "", 0, err
		}
		var n int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM core.mail_drafts`).Scan(&n); err != nil {
			return "", 0, err
		}
		if n >= 1000 {
			return "", 0, ErrEditLimit
		}
		_, err := tx.Exec(ctx, `INSERT INTO core.mail_drafts(tenant_id,account_id,mailbox_id,draft_id,subject,recipients,body_text,revision,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, i.scope.Tenant, i.scope.Account, i.scope.Mailbox, dest, d.Subject, d.To, d.Text, d.Version, d.CreatedAt, d.UpdatedAt)
		return dest, d.Version, err
	})
	if err != nil {
		return err
	}
	if err = i.service.checkpoint("import_after_draft_restore"); err != nil {
		return err
	}
	return i.tx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE core.mail_import_items SET state='VERIFIED',draft_id=$3,draft_receipt_id=$4 WHERE job_id=$1 AND ordinal=$2 AND state='PENDING'`, i.job.ID, item.Ordinal, receipt.ResourceID, receipt.ReceiptID); err != nil {
			return err
		}
		if err := i.service.checkpoint("import_before_item_commit"); err != nil {
			return err
		}
		return i.saveCheckpoint(ctx, tx, "IMPORTING", item.Ordinal, count+1, "")
	})
}
func (i *importSession) verifyDraft(ctx context.Context, item importItem) error {
	raw, err := i.service.Objects.Get(ctx, item.Object)
	if err != nil {
		return err
	}
	var source Draft
	if json.Unmarshal(raw, &source) != nil || !validPortableDraft(source) {
		return ErrIntegrity
	}
	dest, err := i.service.GetDraft(ctx, i.scope, item.DraftID)
	if err != nil {
		return err
	}
	dest.DraftID = source.DraftID
	if !bytes.Equal(encoded(dest), encoded(source)) {
		if err = i.exception(ctx, "draft:"+item.Path, &item.Ordinal, "import_draft_changed_requires_action", false, map[string]any{"path": item.Path}); err != nil {
			return err
		}
		if err = i.setState(ctx, "NEEDS_ACTION"); err != nil {
			return err
		}
		return fmt.Errorf("import_draft_changed_requires_action")
	}
	return i.tx(ctx, func(tx pgx.Tx) error {
		var result []byte
		err := tx.QueryRow(ctx, `SELECT result FROM core.mail_edit_receipts WHERE receipt_id=$1 AND actor_ref=$2 AND operation='mail.drafts.restore'`, item.DraftReceipt, "import:"+i.job.ID).Scan(&result)
		if err != nil {
			return err
		}
		var r EditReceipt
		if json.Unmarshal(result, &r) != nil || r.ResourceID != item.DraftID || r.Version != source.Version {
			return ErrIntegrity
		}
		return nil
	})
}
func (i *importSession) hasOrganizationMapping(org *PortableOrganization) bool {
	if org == nil {
		return true
	}
	if org.Folder != nil && i.collectionDestination(org.Folder.CollectionID) == "" {
		return false
	}
	for _, c := range org.Labels {
		if i.collectionDestination(c.CollectionID) == "" {
			return false
		}
	}
	return true
}
func itemOrganization(item importItem) (*PortableOrganization, error) {
	b, ok := item.Properties["portable_metadata"]
	if !ok {
		return nil, nil
	}
	var m ExportItem
	if err := json.Unmarshal(encoded(b), &m); err != nil {
		return nil, err
	}
	return m.Organization, nil
}
func (i *importSession) mappedOrganization(ctx context.Context, tx pgx.Tx, org *PortableOrganization) (*string, []string, error) {
	var folder *string
	labels := []string{}
	used := map[string]bool{}
	resolve := func(c Collection, kind string) (string, error) {
		dest := i.collectionDestination(c.CollectionID)
		if c.Kind != kind || !idPattern.MatchString(dest) || used[dest] {
			return "", ErrEditInvalid
		}
		used[dest] = true
		var actualKind string
		var actualParent *string
		if err := tx.QueryRow(ctx, `SELECT kind,parent_id::text FROM core.mail_collections WHERE collection_id=$1`, dest).Scan(&actualKind, &actualParent); err != nil {
			return "", err
		}
		if actualKind != kind || (actualParent == nil) != (c.ParentID == nil) || (actualParent != nil && *actualParent != i.collectionDestination(*c.ParentID)) {
			return "", ErrEditInvalid
		}
		return dest, nil
	}
	if org.Folder != nil {
		f, err := resolve(*org.Folder, "folder")
		if err != nil {
			return nil, nil, err
		}
		folder = &f
	}
	if len(org.Labels) > 20 {
		return nil, nil, ErrEditLimit
	}
	for _, c := range org.Labels {
		l, err := resolve(c, "label")
		if err != nil {
			return nil, nil, err
		}
		labels = append(labels, l)
	}
	sort.Strings(labels)
	return folder, labels, nil
}
func (i *importSession) restoreOrganization(ctx context.Context, tx pgx.Tx, item importItem, message string) error {
	org, err := itemOrganization(item)
	if err != nil {
		return err
	}
	if org == nil || !i.hasOrganizationMapping(org) {
		return nil
	}
	folder, labels, err := i.mappedOrganization(ctx, tx, org)
	if err != nil {
		return fmt.Errorf("invalid_destination_collection_mapping: %w", err)
	}
	if err = lockEdit(ctx, tx, i.scope, "message:"+message); err != nil {
		return err
	}
	// This is an initial assignment. A concurrent user edit causes a conflict,
	// never an overwrite. Source revision remains in portable provenance.
	if _, err = tx.Exec(ctx, `INSERT INTO core.mail_message_organization(tenant_id,account_id,mailbox_id,message_id,folder_id,revision) VALUES($1,$2,$3,$4,$5,1)`, i.scope.Tenant, i.scope.Account, i.scope.Mailbox, message, folder); err != nil {
		return err
	}
	for _, label := range labels {
		if _, err = tx.Exec(ctx, `INSERT INTO core.mail_message_labels(tenant_id,account_id,mailbox_id,message_id,label_id) VALUES($1,$2,$3,$4,$5)`, i.scope.Tenant, i.scope.Account, i.scope.Mailbox, message, label); err != nil {
			return err
		}
	}
	return nil
}
func (i *importSession) verifyOrganization(ctx context.Context, item importItem) error {
	org, err := itemOrganization(item)
	if err != nil {
		return err
	}
	if org == nil || !i.hasOrganizationMapping(org) {
		return nil
	}
	return i.tx(ctx, func(tx pgx.Tx) error {
		folder, labels, err := i.mappedOrganization(ctx, tx, org)
		if err != nil {
			return err
		}
		actual, err := portableOrganization(ctx, tx, item.Message)
		if err != nil {
			return err
		}
		if actual == nil {
			return ErrIntegrity
		}
		if (folder == nil) != (actual.Folder == nil) {
			return ErrIntegrity
		}
		if folder != nil && *folder != actual.Folder.CollectionID {
			return ErrIntegrity
		}
		got := []string{}
		for _, c := range actual.Labels {
			got = append(got, c.CollectionID)
		}
		sort.Strings(got)
		if !bytes.Equal(encoded(got), encoded(labels)) {
			return ErrIntegrity
		}
		return nil
	})
}
