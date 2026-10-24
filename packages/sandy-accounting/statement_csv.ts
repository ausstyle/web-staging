import { date, decimal, minor } from "./money.ts";

export type CsvLine = {
  record: number;
  source_key: string;
  effective_date: string;
  amount: string;
  reference: string;
  error?: string;
};

/** Explicit UTF-8 CSV contract; no guessing locale, signs, source IDs or rates. */
export function parseStatementCsv(
  input: unknown,
  precision: number,
): CsvLine[] {
  if (
    typeof input !== "string" ||
    new TextEncoder().encode(input).length > 200000 || input.includes("\0")
  ) throw Error("csv_size_or_encoding");
  const csv = input.replace(/^\uFEFF/, "");
  const records: string[][] = [];
  let row: string[] = [], field = "", quoted = false, closed = false;
  const endField = () => {
    row.push(field);
    field = "";
    closed = false;
  };
  const endRow = () => {
    endField();
    records.push(row);
    row = [];
    if (records.length > 2001) throw Error("csv_row_limit");
  };
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (quoted) {
      if (c === '"') {
        if (csv[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += c;
    } else if (c === ",") endField();
    else if (c === "\r" || c === "\n") {
      if (c === "\r" && csv[i + 1] === "\n") i++;
      endRow();
    } else if (c === '"' && !field && !closed) quoted = true;
    else {
      if (closed || c === '"') {
        throw Error("csv_quote_syntax_record_" + (records.length + 1));
      }
      field += c;
    }
  }
  if (quoted) throw Error("csv_unclosed_quote");
  if (field || row.length || closed) endRow();
  const header = records.shift();
  if (
    header?.length !== 4 ||
    header.join(",") !== "source_key,date,amount,reference"
  ) throw Error("csv_header_expected_source_key_date_amount_reference");
  if (!records.length) throw Error("csv_empty");
  return records.map((fields, i) => {
    const [
      source_key = "",
      effective_date = "",
      rawAmount = "",
      reference = "",
    ] = fields;
    const line: CsvLine = {
      record: i + 2,
      source_key,
      effective_date,
      amount: rawAmount,
      reference,
    };
    try {
      if (fields.length !== 4) throw Error("csv_column_count");
      if (
        !source_key || source_key.length > 300 ||
        source_key.trim() !== source_key || /[\r\n]/.test(source_key)
      ) throw Error("csv_source_key");
      if (!reference || reference.length > 300) throw Error("csv_reference");
      date(effective_date);
      const amount = minor(rawAmount, precision);
      if (amount === 0n) throw Error("zero_statement");
      if (amount <= -(10n ** 30n) || amount >= 10n ** 30n) {
        throw Error("csv_amount_limit");
      }
      line.amount = decimal(amount, precision);
    } catch (error) {
      line.error = (error as Error).message;
    }
    return line;
  });
}
