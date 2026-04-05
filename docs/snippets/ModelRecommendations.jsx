export const ModelRecommendations = ({ role = "all" }) => {
  const parseMarkdownLinks = (text) => {
    const regex = /\[([^\]]+)\]\(([^)]+)\)/g;
    const parts = [];
    let lastIndex = 0;
    let match;
    let key = 0;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        const beforeText = text.slice(lastIndex, match.index);
        if (beforeText) {
          parts.push(<span key={key++}>{beforeText}</span>);
        }
      }

      const [, linkText, url] = match;
      parts.push(
        <a
          key={key++}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#0066cc", textDecoration: "underline" }}
        >
          {linkText}
        </a>,
      );

      lastIndex = regex.lastIndex;
    }

    if (lastIndex < text.length) {
      const remainingText = text.slice(lastIndex);
      if (remainingText) {
        parts.push(<span key={key++}>{remainingText}</span>);
      }
    }

    return parts.length > 0 ? parts : text;
  };

  // Model recommendations data inside component scope
  const modelRecs = {
    agent_plan: {
      open: [
        "[Qwen3 Coder (480B)](https://ai-firewall.dev/openrouter/qwen3-coder)",
        "[Qwen3 Coder (30B)](https://ai-firewall.dev/ollama/qwen3-coder-30b)",
        "[Devstral (27B)](https://ai-firewall.dev/ollama/devstral)",
        "[Kimi K2 (1T)](https://ai-firewall.dev/openrouter/kimi-k2)",
        "[gpt-oss (120B)](https://ai-firewall.dev/openrouter/gpt-oss-120b)",
        "[gpt-oss (20B)](https://ai-firewall.dev/ollama/gpt-oss-20b)",
        "[GLM 4.5 (355B)](https://ai-firewall.dev/openrouter/glm-4-5)",
        "[GLM 4.5 Air (106B)](https://ai-firewall.dev/openrouter/glm-4-5-air)",
      ],
      closed: [
        "[Claude Opus 4.1](https://ai-firewall.dev/anthropic/claude-4-1-opus)",
        "[Claude Sonnet 4](https://ai-firewall.dev/anthropic/claude-4-sonnet)",
        "[GPT-5](https://ai-firewall.dev/openai/gpt-5)",
        "[Gemini 2.5 Pro](https://ai-firewall.dev/google/gemini-2.5-pro)",
      ],
      notes: "Closed models are slightly better than open models",
    },
    chat_edit: {
      open: [
        "[Qwen3 Coder (480B)](https://ai-firewall.dev/openrouter/qwen3-coder)",
        "[Qwen3 Coder (30B)](https://ai-firewall.dev/ollama/qwen3-coder-30b)",
        "[gpt-oss (120B)](https://ai-firewall.dev/openrouter/gpt-oss-120b)",
        "[gpt-oss (20B)](https://ai-firewall.dev/ollama/gpt-oss-20b)",
      ],
      closed: [
        "[Claude Opus 4.1](https://ai-firewall.dev/anthropic/claude-4-1-opus)",
        "[Claude Sonnet 4](https://ai-firewall.dev/anthropic/claude-4-sonnet)",
        "[GPT-5](https://ai-firewall.dev/openai/gpt-5)",
        "[Gemini 2.5 Pro](https://ai-firewall.dev/google/gemini-2.5-pro)",
      ],
      notes: "Closed and open models have pretty similar performance",
    },
    autocomplete: {
      open: [
        "[QwenCoder2.5 (1.5B)](https://ai-firewall.dev/ollama/qwen2.5-coder-1.5b)",
        "[QwenCoder2.5 (7B)](https://ai-firewall.dev/ollama/qwen2.5-coder-7b)",
      ],
      closed: [
        "[Codestral](https://ai-firewall.dev/mistral/codestral)",
        "[Mercury Coder](https://ai-firewall.dev/inception/mercury-coder)",
      ],
      notes: "Closed models are slightly better than open models",
    },
    apply: {
      open: [
        "[FastApply](https://ai-firewall.dev/mdpauley/fast-apply-15b-v10)",
      ],
      closed: [
        "[Relace Instant Apply](https://ai-firewall.dev/relace/instant-apply)",
        "[Morph Fast Apply](https://ai-firewall.dev/morphllm/morph-v2)",
      ],
      notes: "Closed models are better than open models",
    },
    embed: {
      open: [
        "[Nomic Embed Text](https://ai-firewall.dev/ollama/nomic-embed-text-latest)",
        "Qwen3 Embedding",
      ],
      closed: [
        "[Voyage Code 3](https://ai-firewall.dev/voyageai/voyage-code-3)",
        "[Morph Embeddings](https://ai-firewall.dev/morphllm/morph-embedding-v2)",
        "Codestral Embed",
      ],
      notes: "Closed models are slightly better than open models",
    },
    rerank: {
      open: ["zerank-1", "zerank-1-small", "Qwen3 Reranker"],
      closed: [
        "[Voyage Rerank 2.5](https://ai-firewall.dev/voyageai/rerank-2-5)",
        "Relace Code Rerank",
        "[Morph Rerank](https://ai-firewall.dev/morphllm/morph-rerank-v2)",
      ],
      notes: "Open models are beginning to emerge for this model role",
    },
    next_edit: {
      open: ["[Instinct](https://ai-firewall.dev/continuedev/instinct)"],
      closed: [
        "[Mercury Coder](https://ai-firewall.dev/inception/mercury-coder)",
      ],
      notes: "Closed models are better than open models",
    },
  };

  let rolesToShow = [];

  if (!role || role === "all") {
    rolesToShow = Object.keys(modelRecs);
  } else {
    const key = role.toLowerCase().replace(/\s|\//g, "_").replace(/-/g, "_");
    if (modelRecs[key]) {
      rolesToShow = [key];
    }
  }

  if (rolesToShow.length === 0) {
    return <div>No recommendations found for role: {role}</div>;
  }

  return (
    <table
      style={{ width: "100%", borderCollapse: "collapse", marginTop: "1rem" }}
    >
      <thead>
        <tr>
          <th
            style={{
              textAlign: "left",
              borderBottom: "1px solid #ddd",
              padding: "8px",
            }}
          >
            Model role
          </th>
          <th
            style={{
              textAlign: "left",
              borderBottom: "1px solid #ddd",
              padding: "8px",
            }}
          >
            Best open models
          </th>
          <th
            style={{
              textAlign: "left",
              borderBottom: "1px solid #ddd",
              padding: "8px",
            }}
          >
            Best closed models
          </th>
          <th
            style={{
              textAlign: "left",
              borderBottom: "1px solid #ddd",
              padding: "8px",
            }}
          >
            Notes
          </th>
        </tr>
      </thead>
      <tbody>
        {rolesToShow.map((roleKey) => {
          const rec = modelRecs[roleKey];
          if (!rec) return null;

          return (
            <tr key={roleKey}>
              <td
                style={{
                  fontWeight: 600,
                  verticalAlign: "top",
                  padding: "8px",
                }}
              >
                {roleKey
                  .replace(/_/g, " ")
                  .replace(/\b\w/g, (l) => l.toUpperCase())}
              </td>
              <td style={{ padding: "8px", verticalAlign: "top" }}>
                {rec.open.map((m, i) => (
                  <div key={i} style={{ marginBottom: "4px" }}>
                    {parseMarkdownLinks(m)}
                  </div>
                ))}
              </td>
              <td style={{ padding: "8px", verticalAlign: "top" }}>
                {rec.closed.map((m, i) => (
                  <div key={i} style={{ marginBottom: "4px" }}>
                    {parseMarkdownLinks(m)}
                  </div>
                ))}
              </td>
              <td style={{ padding: "8px", verticalAlign: "top" }}>
                {rec.notes}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};
