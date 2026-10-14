export interface TimedItem {
  /** Minutes since local midnight. */
  start: number;
  end: number;
}

export interface LaidOut<T> {
  item: T;
  lane: number;
  lanes: number;
}

/**
 * Lays out one day's events in columns. Events that overlap (transitively)
 * form a cluster and share its width in lanes; an event that overlaps nothing
 * keeps the full column. Greedy lane reuse keeps clusters as narrow as possible.
 */
export function layoutLanes<T extends TimedItem>(input: readonly T[]): LaidOut<T>[] {
  const items = input.toSorted((a, b) => a.start - b.start || b.end - a.end);
  const out: LaidOut<T>[] = [];
  let cluster: { item: T; lane: number }[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    for (const { item, lane } of cluster) out.push({ item, lane, lanes: laneEnds.length });
    cluster = [];
    laneEnds = [];
  };

  for (const item of items) {
    if (item.start >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= item.start);
    if (lane === -1) lane = laneEnds.push(item.end) - 1;
    else laneEnds[lane] = item.end;
    cluster.push({ item, lane });
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  flush();
  return out;
}
