package mailstore

import (
	"context"
	"encoding/json"
	"errors"
	"net/mail"
	"sort"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var ErrEditInvalid = errors.New("invalid_edit")
var ErrEditConflict = errors.New("edit_identity_or_name_conflict")
var ErrEditStale = errors.New("resource_version_conflict")
var ErrEditUnknown = errors.New("edit_outcome_unknown_retry_same_key")
var ErrEditLimit = errors.New("mailbox_edit_limit")

// Actor comes from the authenticated admission boundary, never request arguments.
// The local harness supplies a fixed synthetic actor. Production admission/audit
// integration remains mandatory; these internal methods do not authenticate users.
type EditIdentity struct{ Actor, Key string }
type EditReceipt struct {
	ReceiptID  string    `json:"receipt_id"`
	Operation  string    `json:"operation"`
	ResourceID string    `json:"resource_id"`
	Version    int64     `json:"version"`
	ObservedAt time.Time `json:"observed_at"`
}

func lockEdit(ctx context.Context, tx pgx.Tx, scope Scope, key string) error {
	_, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "mail-edit:"+scope.Tenant+":"+scope.Account+":"+scope.Mailbox+":"+key)
	return err
}
func (s *Service) applyEdit(ctx context.Context, scope Scope, who EditIdentity, operation string, input any, apply func(pgx.Tx) (string, int64, error)) (EditReceipt, error) {
	var out EditReceipt
	if !scope.valid() || !idPattern.MatchString(who.Key) || len(who.Actor) == 0 || len(who.Actor) > 200 {
		return out, ErrEditInvalid
	}
	data, err := json.Marshal(input)
	if err != nil {
		return out, err
	}
	hash := digest(data)
	c, err := s.connection(ctx)
	if err != nil {
		return out, err
	}
	defer c.Release()
	tx, err := scopedTx(ctx, c, scope)
	if err != nil {
		return out, err
	}
	defer tx.Rollback(ctx)
	if err = lockEdit(ctx, tx, scope, "receipt:"+who.Actor+":"+who.Key); err != nil {
		return out, err
	}
	var oldHash, oldOperation string
	var oldResult []byte
	err = tx.QueryRow(ctx, `SELECT input_sha256,operation,result FROM core.mail_edit_receipts WHERE actor_ref=$1 AND mutation_key=$2`, who.Actor, who.Key).Scan(&oldHash, &oldOperation, &oldResult)
	if err == nil {
		if oldHash != hash || oldOperation != operation {
			return out, ErrEditConflict
		}
		if err = json.Unmarshal(oldResult, &out); err != nil {
			return EditReceipt{}, err
		}
		if err = tx.Commit(ctx); err != nil {
			return EditReceipt{}, ErrEditUnknown
		}
		return out, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return out, err
	}
	resource, version, err := apply(tx)
	if err != nil {
		var p *pgconn.PgError
		if errors.As(err, &p) && p.Code == "23505" {
			return out, ErrEditConflict
		}
		return out, err
	}
	out = EditReceipt{uuid(), operation, resource, version, time.Now().UTC()}
	encoded, err := json.Marshal(out)
	if err != nil {
		return EditReceipt{}, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO core.mail_edit_receipts(tenant_id,account_id,mailbox_id,actor_ref,mutation_key,operation,input_sha256,receipt_id,result) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, scope.Tenant, scope.Account, scope.Mailbox, who.Actor, who.Key, operation, hash, out.ReceiptID, encoded)
	if err != nil {
		return EditReceipt{}, err
	}
	if err = s.checkpoint("edit_before_commit"); err != nil {
		return EditReceipt{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return EditReceipt{}, ErrEditUnknown
	}
	if err = s.checkpoint("edit_after_commit"); err != nil {
		return EditReceipt{}, ErrEditUnknown
	}
	return out, nil
}

type DraftInput struct {
	DraftID         string   `json:"draft_id"`
	ExpectedVersion int64    `json:"expected_version"`
	Subject         string   `json:"subject"`
	To              []string `json:"to"`
	Text            string   `json:"text"`
}
type Draft struct {
	DraftID   string    `json:"draft_id"`
	Version   int64     `json:"version"`
	Subject   string    `json:"subject"`
	To        []string  `json:"to"`
	Text      string    `json:"text,omitempty"`
	UpdatedAt time.Time `json:"updated_at"`
	CreatedAt time.Time `json:"created_at"`
}
type DraftCursor struct {
	UpdatedAt time.Time `json:"updated_at"`
	DraftID   string    `json:"draft_id"`
}

func (s *Service) SaveDraft(ctx context.Context, scope Scope, who EditIdentity, input DraftInput) (EditReceipt, error) {
	if !idPattern.MatchString(input.DraftID) || input.ExpectedVersion < 0 || input.ExpectedVersion > 1<<50 || len(input.Subject) > 998 || strings.ContainsAny(input.Subject, "\r\n\x00") || len(input.Text) > 65536 || strings.ContainsRune(input.Text, 0) || !utf8.ValidString(input.Subject) || !utf8.ValidString(input.Text) || len(input.To) > 50 {
		return EditReceipt{}, ErrEditInvalid
	}
	input.To = append([]string{}, input.To...)
	for i, a := range input.To {
		if len(a) > 320 || strings.ContainsAny(a, "\r\n\x00") {
			return EditReceipt{}, ErrEditInvalid
		}
		parsed, err := mail.ParseAddress(a)
		if err != nil {
			return EditReceipt{}, ErrEditInvalid
		}
		input.To[i] = parsed.String()
	}
	return s.applyEdit(ctx, scope, who, "mail.drafts.save", input, func(tx pgx.Tx) (string, int64, error) {
		if err := lockEdit(ctx, tx, scope, "drafts"); err != nil {
			return "", 0, err
		}
		var version int64
		err := tx.QueryRow(ctx, `SELECT revision FROM core.mail_drafts WHERE draft_id=$1 FOR UPDATE`, input.DraftID).Scan(&version)
		if errors.Is(err, pgx.ErrNoRows) {
			if input.ExpectedVersion != 0 {
				return "", 0, ErrEditStale
			}
			var n int
			if err = tx.QueryRow(ctx, `SELECT count(*) FROM core.mail_drafts`).Scan(&n); err != nil {
				return "", 0, err
			}
			if n >= 1000 {
				return "", 0, ErrEditLimit
			}
			_, err = tx.Exec(ctx, `INSERT INTO core.mail_drafts(tenant_id,account_id,mailbox_id,draft_id,subject,recipients,body_text,revision) VALUES($1,$2,$3,$4,$5,$6,$7,1)`, scope.Tenant, scope.Account, scope.Mailbox, input.DraftID, input.Subject, input.To, input.Text)
			return input.DraftID, 1, err
		}
		if err != nil {
			return "", 0, err
		}
		if version != input.ExpectedVersion {
			return "", 0, ErrEditStale
		}
		_, err = tx.Exec(ctx, `UPDATE core.mail_drafts SET subject=$2,recipients=$3,body_text=$4,revision=revision+1,updated_at=clock_timestamp() WHERE draft_id=$1`, input.DraftID, input.Subject, input.To, input.Text)
		return input.DraftID, version + 1, err
	})
}
func (s *Service) GetDraft(ctx context.Context, scope Scope, id string) (Draft, error) {
	var d Draft
	if !idPattern.MatchString(id) {
		return d, ErrEditInvalid
	}
	c, err := s.connection(ctx)
	if err != nil {
		return d, err
	}
	defer c.Release()
	tx, err := scopedTx(ctx, c, scope)
	if err != nil {
		return d, err
	}
	defer tx.Rollback(ctx)
	err = tx.QueryRow(ctx, `SELECT draft_id::text,revision,subject,recipients,body_text,updated_at,created_at FROM core.mail_drafts WHERE draft_id=$1`, id).Scan(&d.DraftID, &d.Version, &d.Subject, &d.To, &d.Text, &d.UpdatedAt, &d.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Draft{}, ErrNotFound
	}
	if err != nil {
		return Draft{}, err
	}
	return d, tx.Commit(ctx)
}
func (s *Service) ListDrafts(ctx context.Context, scope Scope, after *DraftCursor, limit int) ([]Draft, error) {
	if limit < 1 || limit > 100 || (after != nil && (after.UpdatedAt.IsZero() || !idPattern.MatchString(after.DraftID))) {
		return nil, ErrEditInvalid
	}
	c, err := s.connection(ctx)
	if err != nil {
		return nil, err
	}
	defer c.Release()
	tx, err := scopedTx(ctx, c, scope)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var timestamp *time.Time
	var id *string
	if after != nil {
		timestamp = &after.UpdatedAt
		id = &after.DraftID
	}
	rows, err := tx.Query(ctx, `SELECT draft_id::text,revision,subject,recipients,updated_at,created_at FROM core.mail_drafts WHERE ($1::timestamptz IS NULL OR (updated_at,draft_id)<($1::timestamptz,$2::uuid)) ORDER BY updated_at DESC,draft_id DESC LIMIT $3`, timestamp, id, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Draft{}
	for rows.Next() {
		var d Draft
		if err = rows.Scan(&d.DraftID, &d.Version, &d.Subject, &d.To, &d.UpdatedAt, &d.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	return out, tx.Commit(ctx)
}

type CollectionInput struct {
	CollectionID string `json:"collection_id"`
	Kind         string `json:"kind"`
	Name         string `json:"name"`
}
type Collection struct {
	ParentID     *string `json:"parent_id,omitempty"`
	CollectionID string  `json:"collection_id"`
	Kind         string  `json:"kind"`
	Name         string  `json:"name"`
}

func (s *Service) CreateCollection(ctx context.Context, scope Scope, who EditIdentity, input CollectionInput) (EditReceipt, error) {
	return s.CreateCollectionUnder(ctx, scope, who, input, nil)
}
func (s *Service) CreateCollectionUnder(ctx context.Context, scope Scope, who EditIdentity, input CollectionInput, parent *string) (EditReceipt, error) {
	if parent != nil && (!idPattern.MatchString(*parent) || *parent == input.CollectionID || input.Kind != "folder") {
		return EditReceipt{}, ErrEditInvalid
	}
	input.Name = strings.TrimSpace(input.Name)
	if !idPattern.MatchString(input.CollectionID) || (input.Kind != "folder" && input.Kind != "label") || !utf8.ValidString(input.Name) || utf8.RuneCountInString(input.Name) < 1 || utf8.RuneCountInString(input.Name) > 80 || strings.IndexFunc(input.Name, unicode.IsControl) >= 0 || (input.Kind == "folder" && strings.EqualFold(input.Name, "Inbox")) {
		return EditReceipt{}, ErrEditInvalid
	}
	// Preserve the existing root-creation receipt digest for historical replay.
	var identity any = input
	if parent != nil {
		identity = struct {
			CollectionInput
			ParentID string `json:"parent_id"`
		}{input, *parent}
	}
	return s.applyEdit(ctx, scope, who, "mail.collections.create", identity, func(tx pgx.Tx) (string, int64, error) {
		if err := lockEdit(ctx, tx, scope, "collections"); err != nil {
			return "", 0, err
		}
		if parent != nil {
			if err := validateDestinationParent(ctx, tx, *parent); err != nil {
				return "", 0, err
			}
		}
		var n int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM core.mail_collections`).Scan(&n); err != nil {
			return "", 0, err
		}
		if n >= 200 {
			return "", 0, ErrEditLimit
		}
		_, err := tx.Exec(ctx, `INSERT INTO core.mail_collections(tenant_id,account_id,mailbox_id,collection_id,kind,name,normalized_name,parent_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, scope.Tenant, scope.Account, scope.Mailbox, input.CollectionID, input.Kind, input.Name, strings.ToLower(input.Name), parent)
		return input.CollectionID, 1, err
	})
}
func (s *Service) ListCollections(ctx context.Context, scope Scope) ([]Collection, error) {
	c, err := s.connection(ctx)
	if err != nil {
		return nil, err
	}
	defer c.Release()
	tx, err := scopedTx(ctx, c, scope)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, `SELECT collection_id::text,kind,name,parent_id::text FROM core.mail_collections ORDER BY kind,normalized_name,collection_id LIMIT 201`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Collection{}
	for rows.Next() {
		var item Collection
		if err = rows.Scan(&item.CollectionID, &item.Kind, &item.Name, &item.ParentID); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	if len(out) > 200 {
		return nil, ErrEditLimit
	}
	return out, tx.Commit(ctx)
}

type MessageOrganization struct {
	FolderID *string  `json:"folder_id"`
	LabelIDs []string `json:"label_ids"`
	Version  int64    `json:"version"`
}
type OrganizationInput struct {
	MessageID       string   `json:"message_id"`
	ExpectedVersion int64    `json:"expected_version"`
	FolderID        *string  `json:"folder_id"`
	LabelIDs        []string `json:"label_ids"`
}

func readOrganization(ctx context.Context, tx pgx.Tx, id string) (MessageOrganization, error) {
	out := MessageOrganization{LabelIDs: []string{}}
	err := tx.QueryRow(ctx, `SELECT folder_id::text,revision FROM core.mail_message_organization WHERE message_id=$1`, id).Scan(&out.FolderID, &out.Version)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return out, err
	}
	rows, err := tx.Query(ctx, `SELECT label_id::text FROM core.mail_message_labels WHERE message_id=$1 AND active ORDER BY label_id`, id)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var label string
		if err = rows.Scan(&label); err != nil {
			return out, err
		}
		out.LabelIDs = append(out.LabelIDs, label)
	}
	return out, rows.Err()
}
func (s *Service) OrganizeMessage(ctx context.Context, scope Scope, who EditIdentity, input OrganizationInput) (EditReceipt, error) {
	if !idPattern.MatchString(input.MessageID) || input.ExpectedVersion < 0 || input.ExpectedVersion > 1<<50 || len(input.LabelIDs) > 20 || (input.FolderID != nil && !idPattern.MatchString(*input.FolderID)) {
		return EditReceipt{}, ErrEditInvalid
	}
	input.LabelIDs = append([]string{}, input.LabelIDs...)
	sort.Strings(input.LabelIDs)
	for i, id := range input.LabelIDs {
		if !idPattern.MatchString(id) || (i > 0 && input.LabelIDs[i-1] == id) {
			return EditReceipt{}, ErrEditInvalid
		}
	}
	return s.applyEdit(ctx, scope, who, "mail.messages.organize", input, func(tx pgx.Tx) (string, int64, error) {
		if err := lockEdit(ctx, tx, scope, "message:"+input.MessageID); err != nil {
			return "", 0, err
		}
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM core.messages WHERE message_id=$1)`, input.MessageID).Scan(&exists); err != nil {
			return "", 0, err
		}
		if !exists {
			return "", 0, ErrNotFound
		}
		old, err := readOrganization(ctx, tx, input.MessageID)
		if err != nil {
			return "", 0, err
		}
		if old.Version != input.ExpectedVersion {
			return "", 0, ErrEditStale
		}
		if input.FolderID != nil {
			if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM core.mail_collections WHERE collection_id=$1 AND kind='folder')`, input.FolderID).Scan(&exists); err != nil {
				return "", 0, err
			}
			if !exists {
				return "", 0, ErrNotFound
			}
		}
		for _, id := range input.LabelIDs {
			if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM core.mail_collections WHERE collection_id=$1 AND kind='label')`, id).Scan(&exists); err != nil {
				return "", 0, err
			}
			if !exists {
				return "", 0, ErrNotFound
			}
		}
		_, err = tx.Exec(ctx, `INSERT INTO core.mail_message_organization(tenant_id,account_id,mailbox_id,message_id,folder_id,revision) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,account_id,mailbox_id,message_id) DO UPDATE SET folder_id=EXCLUDED.folder_id,revision=EXCLUDED.revision`, scope.Tenant, scope.Account, scope.Mailbox, input.MessageID, input.FolderID, old.Version+1)
		if err != nil {
			return "", 0, err
		}
		_, err = tx.Exec(ctx, `UPDATE core.mail_message_labels SET active=false WHERE message_id=$1 AND active`, input.MessageID)
		if err != nil {
			return "", 0, err
		}
		for _, id := range input.LabelIDs {
			_, err = tx.Exec(ctx, `INSERT INTO core.mail_message_labels(tenant_id,account_id,mailbox_id,message_id,label_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,account_id,mailbox_id,message_id,label_id) DO UPDATE SET active=true`, scope.Tenant, scope.Account, scope.Mailbox, input.MessageID, id)
			if err != nil {
				return "", 0, err
			}
		}
		return input.MessageID, old.Version + 1, nil
	})
}

// Folder filter is "all", "inbox" (no assigned folder), or a scoped UUID.
func validateOrganizationFilter(folder, label string) error {
	if folder != "" && folder != "all" && folder != "inbox" && !idPattern.MatchString(folder) {
		return ErrEditInvalid
	}
	if label != "" && !idPattern.MatchString(label) {
		return ErrEditInvalid
	}
	return nil
}

// Source collection IDs are provenance only on import, never destination scope.
type PortableOrganization struct {
	Version int64        `json:"version"`
	Folder  *Collection  `json:"folder"`
	Labels  []Collection `json:"labels"`
}

func portableOrganization(ctx context.Context, tx pgx.Tx, id string) (*PortableOrganization, error) {
	state, err := readOrganization(ctx, tx, id)
	if err != nil {
		return nil, err
	}
	if state.Version == 0 {
		return nil, nil
	}
	out := &PortableOrganization{Version: state.Version, Labels: []Collection{}}
	read := func(id string) (Collection, error) {
		var c Collection
		err := tx.QueryRow(ctx, `SELECT collection_id::text,kind,name,parent_id::text FROM core.mail_collections WHERE collection_id=$1`, id).Scan(&c.CollectionID, &c.Kind, &c.Name, &c.ParentID)
		return c, err
	}
	if state.FolderID != nil {
		c, err := read(*state.FolderID)
		if err != nil {
			return nil, err
		}
		out.Folder = &c
	}
	for _, id := range state.LabelIDs {
		c, err := read(id)
		if err != nil {
			return nil, err
		}
		out.Labels = append(out.Labels, c)
	}
	return out, nil
}
