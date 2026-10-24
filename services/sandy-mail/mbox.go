package mailstore

import (
	"bufio"
	"bytes"
	"fmt"
	"io"
	"strings"
	"time"
)

// MBOXRDRecord describes an explicitly selected mboxrd dialect. The untouched
// master source is retained separately. Offset/Next cover the encoded record;
// Raw is after reversible From-line unquoting and removal of ONE framing LF.
// Unknown dialects and ambiguous separators are never guessed.
type MBOXRDRecord struct {
	Offset     int64     `json:"offset"`
	Next       int64     `json:"next"`
	Separator  string    `json:"separator"`
	ReceivedAt time.Time `json:"received_at"`
	Raw        []byte    `json:"-"`
}

func mboxSeparator(line []byte, location *time.Location) (time.Time, error) {
	s := strings.TrimSuffix(string(line), "\n")
	s = strings.TrimSuffix(s, "\r")
	if !strings.HasPrefix(s, "From ") {
		return time.Time{}, fmt.Errorf("mboxrd_separator_required")
	}
	_, date, ok := strings.Cut(s[5:], " ")
	if !ok {
		return time.Time{}, fmt.Errorf("mboxrd_ambiguous_separator")
	}
	d, e := time.ParseInLocation("Mon Jan _2 15:04:05 2006", date, location)
	if e != nil {
		return time.Time{}, fmt.Errorf("mboxrd_unsupported_separator_date")
	}
	return d, nil
}

// NextMBOXRD supports seekable immutable source chunks and a durable byte cursor.
// The supported dialect requires LF-terminated RFC822 messages and one extra LF
// between records. Original CRLF and all other bytes are retained. Content-Length
// dialects are not supported. At EOF no message is invented.
func NextMBOXRD(source io.ReaderAt, size, offset int64, location *time.Location) (MBOXRDRecord, error) {
	var rec MBOXRDRecord
	if offset == size {
		return rec, io.EOF
	}
	if offset < 0 || offset > size || location == nil {
		return rec, fmt.Errorf("invalid_mbox_cursor")
	}
	r := bufio.NewReaderSize(io.NewSectionReader(source, offset, size-offset), 64*1024)
	readLine := func() ([]byte, error) {
		var out []byte
		for {
			b, e := r.ReadSlice('\n')
			if len(out)+len(b) > MaxMessageBytes {
				return nil, fmt.Errorf("mbox_line_limit")
			}
			out = append(out, b...)
			if e == bufio.ErrBufferFull {
				continue
			}
			return out, e
		}
	}
	line, e := readLine()
	if e != nil {
		if e != io.EOF && e != io.ErrUnexpectedEOF {
			return rec, e
		}
		return rec, fmt.Errorf("mboxrd_truncated_separator")
	}
	date, e := mboxSeparator(line, location)
	if e != nil {
		return rec, e
	}
	rec = MBOXRDRecord{Offset: offset, Next: offset + int64(len(line)), Separator: string(line), ReceivedAt: date}
	inBody := false
	for {
		line, e = readLine()
		if len(line) > 0 && bytes.HasPrefix(line, []byte("From ")) {
			if _, err := mboxSeparator(line, location); err != nil {
				return rec, err
			}
			break
		}
		rec.Next += int64(len(line))
		if inBody && len(line) > 0 && line[0] == '>' {
			unquoted := bytes.TrimLeft(line, ">")
			if bytes.HasPrefix(unquoted, []byte("From ")) {
				line = line[1:]
			}
		}
		if !inBody && (bytes.Equal(line, []byte("\n")) || bytes.Equal(line, []byte("\r\n"))) {
			inBody = true
		}
		rec.Raw = append(rec.Raw, line...)
		if len(rec.Raw) > MaxMessageBytes {
			return rec, fmt.Errorf("mbox_message_limit")
		}
		if e == io.EOF {
			break
		}
		if e != nil {
			return rec, e
		}
	}
	if !inBody || !bytes.HasSuffix(rec.Raw, []byte("\n\n")) {
		return rec, fmt.Errorf("mboxrd_missing_unambiguous_framing")
	}
	rec.Raw = rec.Raw[:len(rec.Raw)-1]
	// mboxcl/cl2 use Content-Length and different quoting: reject explicitly.
	headers := rec.Raw
	if split := bytes.Index(headers, []byte("\r\n\r\n")); split >= 0 {
		headers = headers[:split]
	} else if split := bytes.Index(headers, []byte("\n\n")); split >= 0 {
		headers = headers[:split]
	}
	for _, h := range bytes.Split(headers, []byte("\n")) {
		if bytes.HasPrefix(bytes.ToLower(h), []byte("content-length:")) {
			return rec, fmt.Errorf("mbox_content_length_dialect_unsupported")
		}
	}
	return rec, nil
}

// WriteMBOXRD emits reversible mboxrd framing; it refuses originals without a
// final LF instead of silently normalizing them. Use original EML export for any
// unsupported input. Portable metadata carries envelope/flags/folder separately.
func WriteMBOXRD(out io.Writer, raw []byte, sender string, received time.Time) (int64, error) {
	if len(raw) == 0 || len(raw) > MaxMessageBytes || raw[len(raw)-1] != '\n' || received.IsZero() || sender == "" || strings.ContainsAny(sender, " \t\r\n\x00") {
		return 0, fmt.Errorf("mboxrd_export_input_unsupported")
	}
	parsed, e := Parse(raw)
	if e != nil {
		return 0, e
	}
	for name := range parsed.Headers {
		if strings.EqualFold(name, "Content-Length") {
			return 0, fmt.Errorf("mbox_content_length_dialect_unsupported")
		}
	}
	var b bytes.Buffer
	fmt.Fprintf(&b, "From %s %s\n", sender, received.UTC().Format("Mon Jan _2 15:04:05 2006"))
	inBody := false
	for len(raw) > 0 {
		n := bytes.IndexByte(raw, '\n') + 1
		line := raw[:n]
		raw = raw[n:]
		if inBody && bytes.HasPrefix(bytes.TrimLeft(line, ">"), []byte("From ")) {
			b.WriteByte('>')
		}
		b.Write(line)
		if !inBody && (bytes.Equal(line, []byte("\n")) || bytes.Equal(line, []byte("\r\n"))) {
			inBody = true
		}
	}
	b.WriteByte('\n')
	n, e := out.Write(b.Bytes())
	if e == nil && n != b.Len() {
		e = io.ErrShortWrite
	}
	return int64(n), e
}
