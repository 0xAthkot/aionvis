import type { ReactNode } from "react";
import { BookText } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/** Inline **bold** / *italic* spans. The card is trusted LLM output rendered
 *  as text nodes, never HTML. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

/** Tiny renderer for the constrained Markdown our card writer emits:
 *  ##/### headings, - lists, --- rules, paragraphs. */
function renderMarkdown(md: string): ReactNode[] {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let para: string[] = [];
  let key = 0;

  const flush = () => {
    if (list.length) {
      blocks.push(
        <ul key={key++} className="list-disc space-y-1 pl-5">
          {list.map((item, i) => (
            <li key={i}>{inline(item)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
    if (para.length) {
      blocks.push(<p key={key++}>{inline(para.join(" "))}</p>);
      para = [];
    }
  };

  for (const raw of md.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("### ")) {
      flush();
      blocks.push(
        <h4 key={key++} className="pt-1 text-sm font-semibold">
          {inline(line.slice(4))}
        </h4>,
      );
    } else if (line.startsWith("## ")) {
      flush();
      blocks.push(
        <h3 key={key++} className="pt-1 text-sm font-semibold tracking-tight">
          {inline(line.slice(3))}
        </h3>,
      );
    } else if (line === "---") {
      flush();
      blocks.push(<hr key={key++} className="border-border" />);
    } else if (line.startsWith("- ")) {
      if (para.length) flush();
      list.push(line.slice(2));
    } else if (line === "") {
      flush();
    } else {
      if (list.length) flush();
      para.push(line);
    }
  }
  flush();
  return blocks;
}

/**
 * The model card the MLOps Agent wrote for these weights after training —
 * agents documenting their own work.
 */
export function ModelCardView({ card }: { card: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookText className="size-4" />
          Model card
        </CardTitle>
        <CardDescription>
          Written autonomously by the MLOps Agent when training finished
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2.5 text-sm text-muted-foreground [&_h3]:text-foreground [&_h4]:text-foreground">
        {renderMarkdown(card)}
      </CardContent>
    </Card>
  );
}
