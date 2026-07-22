import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Smile } from "lucide-react";
import Picker from "@emoji-mart/react";
import data from "@emoji-mart/data";
import { useI18n } from "@/lib/i18n";
import { useMemo } from "react";

// Curated quick reactions (Apple-style rendered via emoji-mart set)
const QUICK = ["❤️", "👍", "😂", "😮", "😢", "🙏"];

export function EmojiPicker({
  onPick,
  quickBar,
}: {
  onPick: (e: string) => void;
  quickBar?: boolean;
}) {
  const { lang } = useI18n();
  const locale = lang === "ar" ? "ar" : "en";

  // Memoise picker so it doesn't re-mount on each parent render (large dataset)
  const picker = useMemo(
    () => (
      <Picker
        data={data}
        onEmojiSelect={(e: any) => onPick(e.native)}
        theme="auto"
        set="apple"
        locale={locale}
        previewPosition="none"
        skinTonePosition="search"
        maxFrequentRows={2}
        perLine={9}
        emojiSize={22}
        emojiButtonSize={34}
      />
    ),
    [onPick, locale]
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-9 w-9 rounded-full text-muted-foreground hover:text-primary"
          aria-label="Emoji"
        >
          <Smile className="h-5 w-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-0 border-[color:var(--brand-gold,#d4af37)]/25 shadow-2xl overflow-hidden"
        align="end"
        sideOffset={8}
      >
        {quickBar && (
          <div className="flex gap-1 p-2 border-b bg-card">
            {QUICK.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => onPick(e)}
                className="emoji-native h-9 w-9 rounded-full hover:bg-accent text-xl transition-transform hover:scale-125"
              >
                {e}
              </button>
            ))}
          </div>
        )}
        {picker}
      </PopoverContent>
    </Popover>
  );
}

export { QUICK as QUICK_REACTIONS };
