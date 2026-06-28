import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { normalizeWorkspaceMarkdown } from "../services/workspaceMarkdown";

const markdownLink: Components["a"] = ({ href, children, ...props }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
    {children}
  </a>
);

const markdownTable: Components["table"] = ({ children, ...props }) => (
  <div className="workspace-markdown__table-wrap">
    <table {...props}>{children}</table>
  </div>
);

interface Props {
  source: string;
  className?: string;
  /** 流式输出中可跳过规范化，减轻半成品结构被误合并 */
  streaming?: boolean;
}

/** 工作台 LLM 输出：GFM Markdown 渲染 */
export function WorkspaceMarkdown({ source, className, streaming = false }: Props) {
  const remarkPlugins = useMemo(() => [remarkGfm], []);
  const components = useMemo<Components>(
    () => ({ a: markdownLink, table: markdownTable }),
    []
  );
  const displaySource = useMemo(
    () => (streaming ? source : normalizeWorkspaceMarkdown(source)),
    [source, streaming]
  );

  return (
    <div className={className ? `workspace-markdown ${className}` : "workspace-markdown"}>
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {displaySource}
      </ReactMarkdown>
    </div>
  );
}
