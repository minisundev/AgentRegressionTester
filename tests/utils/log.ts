import { ResultRow } from "../types/type";
import Table from 'cli-table3';

export function printSummaryTable(title: string, rows: ResultRow[]) {
  console.log(`${title} (${rows.length})`);
  const table = new Table({
    wordWrap: true,
    colWidths: [10, 40, 20, 20, 80, 15],
  });

  table.push(
    ...rows.map(r => [
      r.id,
      r.request,
      r.mainIntent,
      r.subIntent,
      r.response,
      r.time+'ms',
    ])
  );

  console.log(table.toString());
}