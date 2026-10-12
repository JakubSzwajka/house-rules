export default function ErrorPage({ retry }: { retry: () => void }) {
  return (
    <button type="button" style={{ padding: "1rem" }} onClick={retry}>
      Try again
    </button>
  );
}
