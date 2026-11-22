import { Fragment } from 'react';

/** Renderizador mínimo y seguro (sin HTML) para el Markdown que genera el agente. */
function inline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|_\([^)]+\)_|_[^_]+_)/g);
  return parts.map((p, i) => {
    if (/^\*\*.+\*\*$/.test(p)) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (/^_.+_$/.test(p)) return <em key={i}>{p.slice(1, -1)}</em>;
    return <Fragment key={i}>{p}</Fragment>;
  });
}

export function Markdown({ md }: { md: string | null }) {
  if (!md) return <p className="text-sm text-stone">Sin contenido todavía.</p>;
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) {
      blocks.push(
        <ul key={`ul${blocks.length}`}>
          {list.map((l, i) => (
            <li key={i}>{inline(l.replace(/^\[ \]\s*/, ''))}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  for (const line of md.split('\n')) {
    if (/^\s*-\s/.test(line)) {
      list.push(line.replace(/^\s*-\s/, ''));
      continue;
    }
    flush();
    if (/^##\s/.test(line)) blocks.push(<h2 key={blocks.length}>{line.replace(/^##\s*/, '')}</h2>);
    else if (/^>\s/.test(line)) blocks.push(<blockquote key={blocks.length}>{inline(line.replace(/^>\s*/, ''))}</blockquote>);
    else if (line.trim()) blocks.push(<p key={blocks.length} className="mb-2">{inline(line)}</p>);
  }
  flush();
  return <div className="prose-wink text-sm leading-relaxed">{blocks}</div>;
}
