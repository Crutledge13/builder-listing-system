import { HomeArt } from "@/components/home-art";

export default function MediaPage() {
  return (
    <div className="mx-auto max-w-2xl py-10 text-center">
      <div className="mx-auto grid max-w-md grid-cols-3 gap-2 overflow-hidden rounded-2xl opacity-80">
        {["m1", "m2", "m3"].map((s, i) => (
          <HomeArt key={s} seed={s} stories={i === 1 ? 2 : 1} className="aspect-square w-full" />
        ))}
      </div>
      <h1 className="mt-8 text-[28px] font-bold tracking-tight">The media library is next</h1>
      <p className="mx-auto mt-3 max-w-lg text-muted">
        Photos and videos for every home, organized by community and room, searchable, and ready to
        download as an MLS photo pack. It turns on once photo storage is connected.
      </p>
    </div>
  );
}
