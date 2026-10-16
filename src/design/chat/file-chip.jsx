/* chat/file-chip.jsx — "@path" file reference chip. Used read-only inside
   user bubbles and with a remove button in the composer's attachment strip. */

function FileChip({ path, onRemove, removeTitle }) {
  const Icon = window.Icon;
  const trimmed = String(path || "").replace(/\/+$/, "");
  const slash = trimmed.lastIndexOf("/");
  const name = trimmed.slice(slash + 1) || trimmed;
  const dir = slash >= 0 ? trimmed.slice(0, slash + 1) : "";

  return (
    <span className={`file-chip${onRemove ? " removable" : ""}`} title={path}>
      <Icon name="file" size={10} />
      {dir && <span className="file-chip-dir">{dir}</span>}
      <span className="file-chip-name">{name}</span>
      {onRemove && (
        <button
          type="button"
          className="file-chip-x"
          title={removeTitle}
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
        >
          <Icon name="close" size={8} />
        </button>
      )}
    </span>
  );
}

Object.assign(window, { FileChip });
