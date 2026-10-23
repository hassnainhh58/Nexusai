import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism/index.js";

/**
 * The syntax highlighter is ~600 kB, so CodeBlock loads this module lazily.
 * The main bundle therefore no longer ships every Prism grammar up front.
 */
export default function HighlightedCode({ language, code, theme }) {
  return (
    <SyntaxHighlighter
      language={language || "text"}
      style={theme === "dark" ? oneDark : oneLight}
      customStyle={{
        margin: 0,
        padding: "16px",
        background: "transparent",
        fontSize: "13.5px",
        lineHeight: "1.6",
        fontFamily:
          "ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace",
      }}
      wrapLongLines={false}
    >
      {code}
    </SyntaxHighlighter>
  );
}
