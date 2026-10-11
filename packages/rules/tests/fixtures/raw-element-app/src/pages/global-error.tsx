export function GlobalError({ retry }: { retry: () => void }) {
  return (
    <button type="button" onClick={retry}>
      Try again
    </button>
  );
}
