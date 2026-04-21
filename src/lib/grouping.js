/**
 * Group uncertain meetings for one-assignment-per-group review.
 *
 * Order:
 *   1. Multi-meeting domain groups (largest count first)
 *   2. Multi-meeting name groups (largest count first)
 *   3. Singletons (everything else)
 */
function normName(title) {
  return (title || '').trim().toLowerCase();
}

export function groupUncertain(uncertain) {
  // Bucket by domain
  const byDomain = new Map();
  const noDomain = [];
  for (const m of uncertain) {
    if (m.candidateDomain) {
      const arr = byDomain.get(m.candidateDomain) || [];
      arr.push(m);
      byDomain.set(m.candidateDomain, arr);
    } else {
      noDomain.push(m);
    }
  }

  const groups = [];
  const singletons = [];

  // Domain groups: multi-count → group, count==1 → singleton
  for (const [domain, meetings] of byDomain) {
    if (meetings.length >= 2) {
      groups.push({
        id: `d:${domain}`,
        kind: 'domain',
        key: domain,
        meetings,
      });
    } else {
      singletons.push(meetings[0]);
    }
  }

  // Name groups among domain-less meetings
  const byName = new Map();
  for (const m of noDomain) {
    const k = normName(m.title);
    if (!k) {
      singletons.push(m);
      continue;
    }
    const arr = byName.get(k) || [];
    arr.push(m);
    byName.set(k, arr);
  }
  for (const [name, meetings] of byName) {
    if (meetings.length >= 2) {
      groups.push({
        id: `n:${name}`,
        kind: 'name',
        key: name,
        meetings,
      });
    } else {
      singletons.push(meetings[0]);
    }
  }

  groups.sort((a, b) => b.meetings.length - a.meetings.length);

  // Singletons last, one group per meeting
  for (const m of singletons) {
    groups.push({
      id: `s:${groups.length}`,
      kind: 'single',
      key: m.candidateDomain || normName(m.title) || '(no key)',
      meetings: [m],
    });
  }

  return groups;
}
