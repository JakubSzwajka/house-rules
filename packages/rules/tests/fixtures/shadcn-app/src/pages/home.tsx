import { Button } from "@/components/ui/button";

export function Home({ tone }: { tone: string }) {
  return (
    <main className="bg-background text-foreground">
      <Button className="mt-4 p-6">Save</Button>
      <Button className={`mt-${tone}`}>Retry</Button>
      <p className="bg-pink-500">Sale</p>
      <p className="text-[13px]">Small print</p>
      <p style={{ padding: 4 }}>Padded</p>
      <p className="rounded-huge">Typo</p>
    </main>
  );
}
