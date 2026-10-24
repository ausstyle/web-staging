package mailstore

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
)

type roundTrip func(*http.Request) (*http.Response, error)

func (f roundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func response(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}
}
func TestGCSCreateOnlyGenerationAndIntegrityContract(t *testing.T) {
	ctx := context.Background()
	exists := false
	stored := ""
	reads := 0
	client := &http.Client{Transport: roundTrip(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host != "storage.googleapis.com" || r.URL.Scheme != "https" {
			t.Fatal("unexpected provider")
		}
		if r.Method == "POST" {
			if r.URL.Query().Get("ifGenerationMatch") != "0" || r.URL.Query().Get("uploadType") != "media" {
				t.Fatal("missing create-only precondition")
			}
			if exists {
				return response(412, ""), nil
			}
			b, _ := io.ReadAll(r.Body)
			stored = string(b)
			exists = true
			return response(200, `{"generation":"42"}`), nil
		}
		if r.URL.Query().Get("alt") == "media" {
			if r.URL.Query().Get("generation") != "42" {
				t.Fatal("unpinned read")
			}
			reads++
			return response(200, stored), nil
		}
		return response(200, `{"generation":"42"}`), nil
	})}
	s := GCSStore{Bucket: "synthetic-contract-bucket", Client: client}
	o, e := s.Put(ctx, "mail/v1/synthetic/original.eml", []byte("original"))
	if e != nil {
		t.Fatal(e)
	}
	same, e := s.Put(ctx, o.Key, []byte("original"))
	if e != nil || same != o {
		t.Fatalf("412 replay %v", e)
	}
	if _, e = s.Put(ctx, o.Key, []byte("different")); e != ErrIntegrity {
		t.Fatalf("overwrite collision %v", e)
	}
	if reads != 3 {
		t.Fatal("missing independent byte readbacks")
	}
}
func TestGCSOutagesAndRedirectsFailClosed(t *testing.T) {
	for _, status := range []int{301, 403, 429, 500, 503} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			s := GCSStore{Bucket: "synthetic", Client: &http.Client{Transport: roundTrip(func(*http.Request) (*http.Response, error) { return response(status, "private upstream text"), nil })}}
			if _, e := s.Put(context.Background(), "mail/v1/a", []byte("x")); e == nil || strings.Contains(e.Error(), "private upstream") {
				t.Fatal("failure hidden or body disclosed")
			}
		})
	}
}
