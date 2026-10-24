package mailstore

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"bytes"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
)

const MaxMessageBytes = 25 * 1024 * 1024

var ErrObjectNotFound = errors.New("object_not_found")

var ErrIntegrity = errors.New("object_integrity_failure")

type Object struct {
	Key        string `json:"key"`
	Generation int64  `json:"generation"`
	SHA256     string `json:"sha256"`
	Size       int64  `json:"size"`
}
type ObjectStore interface {
	Put(context.Context, string, []byte) (Object, error)
	Get(context.Context, Object) ([]byte, error)
}

func checked(o Object, b []byte) ([]byte, error) {
	if int64(len(b)) != o.Size || digest(b) != o.SHA256 {
		return nil, ErrIntegrity
	}
	return b, nil
}
func validKey(key string) bool {
	return strings.HasPrefix(key, "mail/v1/") && !strings.Contains(key, "..") && !strings.ContainsAny(key, "\\\x00")
}

// GCSStore uses a pre-existing private bucket and the caller's scoped workload
// credentials. It never creates buckets, changes IAM, or overwrites an object.
type GCSStore struct {
	Bucket string
	Client *http.Client
}

func (s GCSStore) request(ctx context.Context, method, path string, b []byte) ([]byte, int, error) {
	if s.Bucket == "" || s.Client == nil {
		return nil, 0, fmt.Errorf("gcs_configuration_required")
	}
	req, err := http.NewRequestWithContext(ctx, method, "https://storage.googleapis.com"+path, bytes.NewReader(b))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/octet-stream")
	// Never follow redirects with a privileged workload client.
	client := *s.Client
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	resp, err := client.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("gcs_transport_failed")
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, MaxMessageBytes+1))
	if err != nil {
		return nil, resp.StatusCode, err
	}
	return body, resp.StatusCode, nil
}
func (s GCSStore) metadata(ctx context.Context, key string) (int64, error) {
	b, status, err := s.request(ctx, "GET", "/storage/v1/b/"+url.PathEscape(s.Bucket)+"/o/"+url.PathEscape(key), nil)
	if err != nil {
		return 0, err
	}
	if status != 200 {
		return 0, fmt.Errorf("gcs_metadata_http_%d", status)
	}
	var a struct {
		Generation string `json:"generation"`
	}
	if err = json.Unmarshal(b, &a); err != nil {
		return 0, err
	}
	return strconv.ParseInt(a.Generation, 10, 64)
}
func (s GCSStore) Put(ctx context.Context, key string, b []byte) (Object, error) {
	if !validKey(key) || len(b) > MaxMessageBytes {
		return Object{}, fmt.Errorf("invalid_object")
	}
	_, status, err := s.request(ctx, "POST", "/upload/storage/v1/b/"+url.PathEscape(s.Bucket)+"/o?uploadType=media&ifGenerationMatch=0&name="+url.QueryEscape(key), b)
	if err != nil {
		return Object{}, err
	}
	if status != 200 && status != 201 && status != 412 {
		return Object{}, fmt.Errorf("gcs_write_http_%d", status)
	}
	generation, err := s.metadata(ctx, key)
	if err != nil {
		return Object{}, err
	}
	o := Object{key, generation, digest(b), int64(len(b))}
	_, err = s.Get(ctx, o)
	return o, err
}
func (s GCSStore) Get(ctx context.Context, o Object) ([]byte, error) {
	if !validKey(o.Key) || o.Generation <= 0 || o.Size > MaxMessageBytes {
		return nil, ErrIntegrity
	}
	b, status, err := s.request(ctx, "GET", "/storage/v1/b/"+url.PathEscape(s.Bucket)+"/o/"+url.PathEscape(o.Key)+"?alt=media&generation="+strconv.FormatInt(o.Generation, 10), nil)
	if err != nil {
		return nil, err
	}
	if status == 404 {
		return nil, ErrObjectNotFound
	}
	if status != 200 {
		return nil, fmt.Errorf("gcs_read_http_%d", status)
	}
	return checked(o, b)
}

// LocalStore is for local synthetic testing ONLY. Atomic link plus fsync prevents
// readers observing partially written objects. It is not Cloud Storage evidence.
type LocalStore struct{ Root string }

func (s LocalStore) Put(ctx context.Context, key string, b []byte) (Object, error) {
	if !validKey(key) || len(b) > MaxMessageBytes {
		return Object{}, fmt.Errorf("invalid_object")
	}
	p := filepath.Join(s.Root, key)
	if err := os.MkdirAll(filepath.Dir(p), 0700); err != nil {
		return Object{}, err
	}
	f, err := os.CreateTemp(filepath.Dir(p), ".upload-")
	if err != nil {
		return Object{}, err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(b); err == nil {
		err = f.Sync()
	}
	ce := f.Close()
	if err == nil {
		err = ce
	}
	if err != nil {
		return Object{}, err
	}
	if err = os.Link(f.Name(), p); err != nil && !errors.Is(err, os.ErrExist) {
		return Object{}, err
	}
	d, err := os.Open(filepath.Dir(p))
	if err != nil {
		return Object{}, err
	}
	err = d.Sync()
	d.Close()
	if err != nil {
		return Object{}, err
	}
	o := Object{key, 1, digest(b), int64(len(b))}
	_, err = s.Get(ctx, o)
	return o, err
}
func (s LocalStore) Get(ctx context.Context, o Object) ([]byte, error) {
	if !validKey(o.Key) || o.Generation != 1 {
		return nil, ErrIntegrity
	}
	f, err := os.Open(filepath.Join(s.Root, o.Key))
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrObjectNotFound
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, MaxMessageBytes+1))
	if err != nil {
		return nil, err
	}
	return checked(o, b)
}
