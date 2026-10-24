/** Fixed local fixtures only; not a provider, tax rule or customer import. */
export const syntheticCsvFiles = [
  {
    name: "Synthetic receipts and unresolved fee",
    file_id: "synthetic-bank-csv-1",
    csv:
      'source_key,date,amount,reference\r\nCSV-OPENING,2026-10-01,1000.00,Synthetic opening\r\nCSV-RECEIPT,2026-10-03,100.00,"Synthetic receipt, DEMO-001"\r\nCSV-FEE,2026-10-04,-2.50,Synthetic unexplained fee\r\n',
  },
  {
    name: "Synthetic changed source conflict",
    file_id: "synthetic-bank-csv-conflict",
    csv:
      "source_key,date,amount,reference\nCSV-OPENING,2026-10-01,999.00,Synthetic opening\n",
  },
  {
    name: "Synthetic possible duplicate",
    file_id: "synthetic-bank-csv-possible",
    csv:
      "source_key,date,amount,reference\nCSV-OPENING-ALT,2026-10-01,1000.00,Synthetic opening\n",
  },
];
