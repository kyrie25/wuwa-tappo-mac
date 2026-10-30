import { readFileSync } from 'node:fs';
import { parse } from 'acorn';

const englishText = JSON.parse(readFileSync(new URL('./english-text.json', import.meta.url), 'utf8'));

export function patchEnglishFrontend(source) {
  if (source.includes('const APP_REGION=')) {
    source = source.replace('[[2,"Ctrl"],[1,"Alt"],[4,"Shift"],[8,"Win"]]', '[[2,"Ctrl"],[1,"Option"],[4,"Shift"],[8,"Cmd"]]');
  }
  const tree = parse(source, { sourceType: 'module', ecmaVersion: 'latest' });
  const edits = [];
  const main = source.includes('const APP_REGION=');
  let initialLocale = 0;
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (main && node.type === 'FunctionDeclaration' && node.id.name === 'getInitialAppLocale') {
      edits.push({ start: node.body.start, end: node.body.end, text: '{return"en"}' });
      initialLocale += 1;
      return;
    }
    const text = node.type === 'Literal' ? node.value : node.type === 'TemplateElement' ? node.value.cooked : null;
    if (typeof text === 'string' && Object.hasOwn(englishText, text)) {
      const replacement = englishText[text];
      edits.push({ start: node.start, end: node.end, text: node.type === 'Literal'
        ? JSON.stringify(replacement) : replacement.replace(/[`\\]/g, '\\$&').replace(/\$\{/g, '\\${') });
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(tree);
  if (main && initialLocale !== 1) throw new Error('Official locale initialization changed; review English preparation before building.');
  for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  return source;
}
