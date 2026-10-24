package mailstore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

type CollectionInventory struct {
	Version     int          `json:"version"`
	Collections []Collection `json:"collections"`
}

// Return parents before children; reject malformed graphs rather than flattening.
func orderedCollections(in CollectionInventory) ([]Collection, error) {
	if in.Version != 1 || in.Collections == nil || len(in.Collections) > 200 {
		return nil, ErrEditInvalid
	}
	byID := map[string]Collection{}
	siblings := map[string]bool{}
	for _, c := range in.Collections {
		if !idPattern.MatchString(c.CollectionID) || (c.Kind != "folder" && c.Kind != "label") || !utf8.ValidString(c.Name) || c.Name != strings.TrimSpace(c.Name) || utf8.RuneCountInString(c.Name) < 1 || utf8.RuneCountInString(c.Name) > 80 || strings.IndexFunc(c.Name, unicode.IsControl) >= 0 || (c.Kind == "folder" && strings.EqualFold(c.Name, "Inbox")) {
			return nil, ErrEditInvalid
		}
		if _, ok := byID[c.CollectionID]; ok {
			return nil, ErrEditInvalid
		}
		parent := ""
		if c.ParentID != nil {
			parent = *c.ParentID
			if !idPattern.MatchString(parent) || c.Kind != "folder" {
				return nil, ErrEditInvalid
			}
		}
		key := c.Kind + ":" + parent + ":" + strings.ToLower(c.Name)
		if siblings[key] {
			return nil, ErrEditConflict
		}
		siblings[key] = true
		byID[c.CollectionID] = c
	}
	result := []Collection{}
	seen := map[string]bool{}
	visiting := map[string]bool{}
	depths := map[string]int{}
	var visit func(string) (int, error)
	visit = func(id string) (int, error) {
		if seen[id] {
			return depths[id], nil
		}
		if visiting[id] {
			return 0, ErrEditInvalid
		}
		c, ok := byID[id]
		if !ok {
			return 0, ErrEditInvalid
		}
		visiting[id] = true
		depth := 1
		if c.ParentID != nil {
			p, ok := byID[*c.ParentID]
			if !ok || p.Kind != "folder" {
				return 0, ErrEditInvalid
			}
			n, e := visit(*c.ParentID)
			if e != nil {
				return 0, e
			}
			depth = n + 1
		}
		if depth > 32 {
			return 0, ErrEditLimit
		}
		seen[id] = true
		visiting[id] = false
		depths[id] = depth
		result = append(result, c)
		return depth, nil
	}
	ids := []string{}
	for id := range byID {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		if _, e := visit(id); e != nil {
			return nil, e
		}
	}
	return result, nil
}
func validateDestinationParent(ctx context.Context, tx pgx.Tx, parent string) error {
	seen := map[string]bool{}
	depth := 1
	for parent != "" {
		if seen[parent] || depth >= 32 {
			return ErrEditLimit
		}
		seen[parent] = true
		var kind string
		var next *string
		if err := tx.QueryRow(ctx, `SELECT kind,parent_id::text FROM core.mail_collections WHERE collection_id=$1`, parent).Scan(&kind, &next); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		if kind != "folder" {
			return ErrEditInvalid
		}
		depth++
		parent = ""
		if next != nil {
			parent = *next
		}
	}
	return nil
}
func snapshotCollections(ctx context.Context, tx pgx.Tx) ([]ExportItem, error) {
	rows, err := tx.Query(ctx, `SELECT collection_id::text,kind,name,parent_id::text FROM core.mail_collections ORDER BY collection_id LIMIT 201`)
	if err != nil {
		return nil, err
	}
	inventory := CollectionInventory{Version: 1, Collections: []Collection{}}
	for rows.Next() {
		var c Collection
		if err = rows.Scan(&c.CollectionID, &c.Kind, &c.Name, &c.ParentID); err != nil {
			rows.Close()
			return nil, err
		}
		inventory.Collections = append(inventory.Collections, c)
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return nil, err
	}
	if _, err = orderedCollections(inventory); err != nil {
		return nil, err
	}
	if len(inventory.Collections) == 0 {
		return []ExportItem{}, nil
	}
	raw := encoded(inventory)
	return []ExportItem{{Collections: &inventory, Path: "collections.json", Raw: Object{SHA256: digest(raw), Size: int64(len(raw))}}}, nil
}
func (i *importSession) collectionDestination(source string) string {
	if i.job.Spec.RestoreCollections {
		return portableID("collection:" + i.job.ID + ":" + source)
	}
	return i.job.Spec.CollectionMap[source]
}
func (i *importSession) collectionInventory(ctx context.Context, item importItem) (CollectionInventory, []Collection, error) {
	raw, e := i.service.Objects.Get(ctx, item.Object)
	if e != nil {
		return CollectionInventory{}, nil, e
	}
	var in CollectionInventory
	if json.Unmarshal(raw, &in) != nil {
		return in, nil, ErrIntegrity
	}
	ordered, e := orderedCollections(in)
	return in, ordered, e
}
func (i *importSession) checkCollectionMapping(ctx context.Context, tx pgx.Tx, ordered []Collection, exactNames bool) error {
	for _, source := range ordered {
		dest := i.collectionDestination(source.CollectionID)
		if dest == "" {
			return ErrEditInvalid
		}
		var kind, name string
		var parent *string
		if err := tx.QueryRow(ctx, `SELECT kind,name,parent_id::text FROM core.mail_collections WHERE collection_id=$1`, dest).Scan(&kind, &name, &parent); err != nil {
			return err
		}
		if kind != source.Kind || (exactNames && name != source.Name) || (parent == nil) != (source.ParentID == nil) {
			return ErrIntegrity
		}
		if parent != nil && *parent != i.collectionDestination(*source.ParentID) {
			return ErrIntegrity
		}
	}
	return nil
}
func (i *importSession) importCollections(ctx context.Context, item importItem, count int64) error {
	in, ordered, err := i.collectionInventory(ctx, item)
	if err != nil {
		return err
	}
	missing := []string{}
	for _, c := range ordered {
		if i.collectionDestination(c.CollectionID) == "" {
			missing = append(missing, c.CollectionID)
		}
	}
	if len(missing) > 0 {
		return i.tx(ctx, func(tx pgx.Tx) error {
			if _, err := tx.Exec(ctx, `INSERT INTO core.mail_import_exceptions VALUES($1,$2,$3,$4,$5,$6,'collection_inventory_mapping_pending',false,$7,false) ON CONFLICT DO NOTHING`, i.scope.Tenant, i.scope.Account, i.scope.Mailbox, i.job.ID, fmt.Sprintf("item:%d", item.Ordinal), item.Ordinal, encoded(map[string]any{"missing_collection_ids": missing, "collection_count": len(ordered), "original_object": item.Object})); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `UPDATE core.mail_import_items SET state='EXCEPTION' WHERE job_id=$1 AND ordinal=$2 AND state='PENDING'`, i.job.ID, item.Ordinal); err != nil {
				return err
			}
			return i.saveCheckpoint(ctx, tx, "IMPORTING", item.Ordinal, count+1, "")
		})
	}
	receipt, err := i.service.applyEdit(ctx, i.scope, EditIdentity{"import:" + i.job.ID, portableID("collection-inventory:" + item.Path)}, "mail.collections.restore", struct {
		Inventory CollectionInventory
		Mapping   map[string]string
		Create    bool
	}{in, i.job.Spec.CollectionMap, i.job.Spec.RestoreCollections}, func(tx pgx.Tx) (string, int64, error) {
		if err := lockEdit(ctx, tx, i.scope, "collections"); err != nil {
			return "", 0, err
		}
		if i.job.Spec.RestoreCollections {
			var count int
			if err := tx.QueryRow(ctx, `SELECT count(*) FROM core.mail_collections`).Scan(&count); err != nil {
				return "", 0, err
			}
			if count+len(ordered) > 200 {
				return "", 0, ErrEditLimit
			}
			for _, c := range ordered {
				var parent *string
				if c.ParentID != nil {
					p := i.collectionDestination(*c.ParentID)
					parent = &p
				}
				if _, err := tx.Exec(ctx, `INSERT INTO core.mail_collections(tenant_id,account_id,mailbox_id,collection_id,kind,name,normalized_name,parent_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, i.scope.Tenant, i.scope.Account, i.scope.Mailbox, i.collectionDestination(c.CollectionID), c.Kind, c.Name, strings.ToLower(c.Name), parent); err != nil {
					return "", 0, err
				}
				if err := i.service.checkpoint("import_after_collection_insert"); err != nil {
					return "", 0, err
				}
			}
		}
		if err := i.checkCollectionMapping(ctx, tx, ordered, i.job.Spec.RestoreCollections); err != nil {
			return "", 0, err
		}
		return portableID("inventory:" + i.job.ID), 1, nil
	})
	if err != nil {
		if errors.Is(err, ErrEditConflict) || errors.Is(err, ErrEditLimit) || errors.Is(err, ErrIntegrity) || errors.Is(err, ErrEditInvalid) || errors.Is(err, pgx.ErrNoRows) {
			if e := i.exception(ctx, "collections:"+item.Path, &item.Ordinal, "collection_restore_requires_action", false, map[string]any{"path": item.Path, "collection_count": len(ordered)}); e != nil {
				return e
			}
			if e := i.setState(ctx, "NEEDS_ACTION"); e != nil {
				return e
			}
		}
		return err
	}
	if err = i.service.checkpoint("import_after_collection_restore"); err != nil {
		return err
	}
	return i.tx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE core.mail_import_items SET state='VERIFIED',collection_receipt_id=$3 WHERE job_id=$1 AND ordinal=$2 AND state='PENDING'`, i.job.ID, item.Ordinal, receipt.ReceiptID); err != nil {
			return err
		}
		if err := i.service.checkpoint("import_before_item_commit"); err != nil {
			return err
		}
		return i.saveCheckpoint(ctx, tx, "IMPORTING", item.Ordinal, count+1, "")
	})
}
func (i *importSession) verifyCollections(ctx context.Context, item importItem) error {
	inventory, ordered, err := i.collectionInventory(ctx, item)
	if err != nil {
		return err
	}
	return i.tx(ctx, func(tx pgx.Tx) error {
		if err := i.checkCollectionMapping(ctx, tx, ordered, i.job.Spec.RestoreCollections); err != nil {
			return err
		}
		var operation, actor, inputHash string
		var result []byte
		err := tx.QueryRow(ctx, `SELECT operation,actor_ref,input_sha256,result FROM core.mail_edit_receipts WHERE receipt_id=$1`, item.CollectionReceipt).Scan(&operation, &actor, &inputHash, &result)
		if err != nil {
			return err
		}
		var receipt EditReceipt
		expected := struct {
			Inventory CollectionInventory
			Mapping   map[string]string
			Create    bool
		}{inventory, i.job.Spec.CollectionMap, i.job.Spec.RestoreCollections}
		if json.Unmarshal(result, &receipt) != nil || receipt.ResourceID != portableID("inventory:"+i.job.ID) || inputHash != digest(encoded(expected)) || operation != "mail.collections.restore" || actor != "import:"+i.job.ID {
			return ErrIntegrity
		}
		return nil
	})
}

func validateManifestCollections(m *ExportManifest, items []ArchiveItem) error {
	var inventory *CollectionInventory
	for n, item := range items {
		if item.Collections != nil {
			if n != 0 || inventory != nil || m.Version != 3 {
				return ErrIntegrity
			}
			inventory = item.Collections
		}
	}
	if inventory == nil {
		return nil
	}
	byID := map[string]Collection{}
	for _, c := range inventory.Collections {
		byID[c.CollectionID] = c
	}
	check := func(c Collection, kind string) error {
		found, ok := byID[c.CollectionID]
		if !ok || c.Kind != kind || string(encoded(found)) != string(encoded(c)) {
			return ErrIntegrity
		}
		return nil
	}
	for _, item := range m.Messages {
		if item.Organization == nil {
			continue
		}
		if item.Organization.Folder != nil {
			if err := check(*item.Organization.Folder, "folder"); err != nil {
				return err
			}
		}
		for _, label := range item.Organization.Labels {
			if err := check(label, "label"); err != nil {
				return err
			}
		}
	}
	return nil
}
