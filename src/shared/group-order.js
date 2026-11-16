// Tag dragging changes only the flat display order. Membership and titles
// stay with their individual Tags, including saved and empty Tags.
export function planGroupReorder({ order = [], sourceKeys = [], targetKey = '', intent = 'after' } = {}) {
  const keys = [...new Set(order)];
  const sources = new Set(sourceKeys);
  if (!sources.size || [...sources].some((key) => !keys.includes(key))) {
    return { error: 'missing-source', message: 'The dragged group changed. Try the drag again.' };
  }
  if (!['before', 'after', 'end'].includes(intent)) {
    return { error: 'invalid-intent', message: 'Groups can only be reordered.' };
  }
  if (intent !== 'end' && (!keys.includes(targetKey) || sources.has(targetKey))) {
    return { error: 'invalid-target', message: 'Choose another group to reorder.' };
  }
  const moving = keys.filter((key) => sources.has(key));
  const next = keys.filter((key) => !sources.has(key));
  const index = intent === 'end' ? next.length : next.indexOf(targetKey) + Number(intent === 'after');
  next.splice(index, 0, ...moving);
  return { order: next, sourceKeys: moving, targetKey, intent };
}
