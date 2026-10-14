export function OpenLink({ openHref }: { openHref: string }) {
  return (
    <a className="shot-open" href={openHref} target="_blank" rel="noreferrer">
      <span>open bundle &#8599;</span>
    </a>
  );
}
