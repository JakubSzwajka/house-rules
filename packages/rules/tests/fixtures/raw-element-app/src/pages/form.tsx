import { Button } from "../components/ui/button";

export function Form({ rows }: { rows: { Row: () => null } }) {
  return (
    <form>
      <button type="submit">Save</button>
      <input name="title" />
      <input type="hidden" name="id" value="7" />
      <input type={"hidden"} name="token" value="x" />
      <select name="tone" />
      <textarea name="body" />
      <table />
      <rows.Row />
      <a href="/home">Home</a>
      <Button>Go</Button>
    </form>
  );
}
