test('detectScope returns empty string for empty files', () => {
  expect(detectScope([])).toBe('');
});