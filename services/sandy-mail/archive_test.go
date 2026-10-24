package mailstore

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"testing"
	"time"
)

func testTAR(t *testing.T, names []string, payloads [][]byte) []byte {
	t.Helper()
	var b bytes.Buffer
	w := tar.NewWriter(&b)
	for i, name := range names {
		if e := w.WriteHeader(&tar.Header{Name: name, Size: int64(len(payloads[i])), Mode: 0600, ModTime: time.Unix(123, 0)}); e != nil {
			t.Fatal(e)
		}
		if _, e := w.Write(payloads[i]); e != nil {
			t.Fatal(e)
		}
	}
	if e := w.Close(); e != nil {
		t.Fatal(e)
	}
	return b.Bytes()
}
func TestArchiveMaildirAndEMLBytePreservation(t *testing.T) {
	raw := SyntheticFixture
	names := []string{"Inbox/cur/123:2,FSz", "Archive/new/456", "Sent/copy.eml"}
	archive := testTAR(t, names, [][]byte{raw, raw, raw})
	count := 0
	preview, e := InspectTAR(bytes.NewReader(archive), func(item ArchiveItem, data []byte) error {
		count++
		if !bytes.Equal(data, raw) || item.SHA256 != digest(raw) {
			t.Fatal("byte loss")
		}
		return nil
	})
	if e != nil || preview.State != "READY" || count != 3 || preview.Entries != 3 {
		t.Fatalf("preview: %+v %v", preview, e)
	}
	if preview.Items[0].Folder != "Inbox" || preview.Items[0].UnmappedFlags != "z" || len(preview.Items[0].Flags) != 2 || preview.Items[1].Folder != "Archive" {
		t.Fatal("Maildir properties lost")
	}
	var b bytes.Buffer
	zw := zip.NewWriter(&b)
	for _, name := range names {
		w, e := zw.Create(name)
		if e != nil {
			t.Fatal(e)
		}
		w.Write(raw)
	}
	zw.Close()
	zipped, e := InspectZIP(bytes.NewReader(b.Bytes()), int64(b.Len()), nil)
	if e != nil || zipped.State != "READY" || len(zipped.Items) != 3 {
		t.Fatalf("ZIP inventory %v %+v", e, zipped)
	}
	for i := range preview.Items {
		if preview.Items[i].SHA256 != zipped.Items[i].SHA256 {
			t.Fatal("format conversion changed message")
		}
	}
}
func TestArchiveExceptionsAndUnsafeInputs(t *testing.T) {
	for _, name := range []string{"../escape.eml", "/absolute.eml", "a/../escape.eml", "a\\escape.eml"} {
		t.Run(name, func(t *testing.T) {
			p, e := InspectTAR(bytes.NewReader(testTAR(t, []string{name}, [][]byte{SyntheticFixture})), nil)
			if e == nil || p.State != "NEEDS_ACTION" {
				t.Fatal("unsafe path accepted")
			}
		})
	}
	duplicated := testTAR(t, []string{"a.eml", "a.eml"}, [][]byte{SyntheticFixture, SyntheticFixture})
	if _, e := InspectTAR(bytes.NewReader(duplicated), nil); e == nil {
		t.Fatal("duplicate path silently lost")
	}
	archive := testTAR(t, []string{"a.pst", "Inbox/tmp/inflight", "broken.eml", "good.eml"}, [][]byte{{1}, {2}, []byte("not mime"), SyntheticFixture})
	p, e := InspectTAR(bytes.NewReader(archive), nil)
	if e != nil || p.State != "NEEDS_ACTION" || len(p.Exceptions) != 3 || len(p.Items) != 1 || p.Entries != len(p.Items)+len(p.Exceptions)+p.StructuralEntries {
		t.Fatalf("unaccounted source %+v %v", p, e)
	}
	valid := testTAR(t, []string{"a.eml"}, [][]byte{SyntheticFixture})
	if _, e = InspectTAR(bytes.NewReader(append(valid, []byte("hidden trailing item")...)), nil); e == nil {
		t.Fatal("trailing content hidden")
	}
	if p, e = InspectTAR(bytes.NewReader(valid), func(ArchiveItem, []byte) error { return errors.New("interrupted") }); e == nil || p.State != "NEEDS_ACTION" {
		t.Fatal("interruption claimed complete")
	}
	var b bytes.Buffer
	tw := tar.NewWriter(&b)
	tw.WriteHeader(&tar.Header{Name: "link.eml", Linkname: "/outside", Typeflag: tar.TypeSymlink})
	tw.Close()
	p, e = InspectTAR(bytes.NewReader(b.Bytes()), nil)
	if e != nil || len(p.Exceptions) != 1 {
		t.Fatal("link not surfaced")
	}
}
func TestArchiveBoundsAndManifest(t *testing.T) {
	var b bytes.Buffer
	tw := tar.NewWriter(&b)
	tw.WriteHeader(&tar.Header{Name: "bomb.eml", Size: MaxMessageBytes + 1, Mode: 0600})
	if _, e := InspectTAR(bytes.NewReader(b.Bytes()), nil); e == nil {
		t.Fatal("oversized entry accepted")
	}
	manifest := ExportManifest{Version: 1, Complete: true, Messages: []ExportItem{{Path: "a.eml", Raw: Object{SHA256: digest(SyntheticFixture), Size: int64(len(SyntheticFixture))}}}}
	encoded, _ := json.Marshal(manifest)
	p, e := InspectTAR(bytes.NewReader(testTAR(t, []string{"a.eml", "manifest.json"}, [][]byte{SyntheticFixture, encoded})), nil)
	if e != nil || p.State != "READY" {
		t.Fatalf("valid manifest %v %+v", e, p)
	}
	manifest.Messages[0].Raw.SHA256 = "corrupted"
	encoded, _ = json.Marshal(manifest)
	p, e = InspectTAR(bytes.NewReader(testTAR(t, []string{"a.eml", "manifest.json"}, [][]byte{SyntheticFixture, encoded})), nil)
	if e != nil || p.State != "NEEDS_ACTION" || len(p.Exceptions) != 1 {
		t.Fatal("manifest hash mismatch hidden")
	}
	var zipped bytes.Buffer
	zw := zip.NewWriter(&zipped)
	w, _ := zw.Create("bomb.eml")
	w.Write(bytes.Repeat([]byte{0}, MaxMessageBytes+1))
	zw.Close()
	if _, e := InspectZIP(bytes.NewReader(zipped.Bytes()), int64(zipped.Len()), nil); e == nil {
		t.Fatal("zip bomb accepted")
	}
}

func TestArchiveCorruptionAndEntryLimit(t *testing.T) {
	var zipped bytes.Buffer
	zw := zip.NewWriter(&zipped)
	w, e := zw.CreateHeader(&zip.FileHeader{Name: "plain.eml", Method: zip.Store})
	if e != nil {
		t.Fatal(e)
	}
	w.Write(SyntheticFixture)
	zw.Close()
	broken := append([]byte(nil), zipped.Bytes()...)
	start := bytes.Index(broken, SyntheticFixture)
	if start < 0 {
		t.Fatal("fixture not found")
	}
	broken[start+10] ^= 1
	if _, e := InspectZIP(bytes.NewReader(broken), int64(len(broken)), nil); e == nil {
		t.Fatal("CRC corruption accepted")
	}
	var archive bytes.Buffer
	tw := tar.NewWriter(&archive)
	for i := 0; i <= MaxArchiveEntries; i++ {
		tw.WriteHeader(&tar.Header{Name: fmt.Sprintf("directory-%d/", i), Typeflag: tar.TypeDir, Mode: 0700})
	}
	tw.Close()
	if _, e := InspectTAR(bytes.NewReader(archive.Bytes()), nil); e == nil {
		t.Fatal("entry overflow accepted")
	}
	mixed := []byte("From: sender@example.invalid\r\nTo: fixture@example.invalid\r\nSubject: =?ISO-8859-1?Q?caf=E9?=\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=iso-8859-1\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\ncaf=E9\r\n")
	p, e := InspectTAR(bytes.NewReader(testTAR(t, []string{"legacy.eml"}, [][]byte{mixed})), func(_ ArchiveItem, raw []byte) error {
		if !bytes.Equal(raw, mixed) {
			t.Fatal("legacy original transcoded")
		}
		parsed, e := Parse(raw)
		if e != nil {
			return e
		}
		if parsed.Subject != "café" {
			t.Fatal("legacy header lost")
		}
		return nil
	})
	if e != nil || p.State != "READY" {
		t.Fatalf("legacy fixture %+v %v", p, e)
	}
}
