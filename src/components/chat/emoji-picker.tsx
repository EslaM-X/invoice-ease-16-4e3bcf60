import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Smile } from "lucide-react";
import { cn } from "@/lib/utils";

const CATEGORIES: Record<string, string[]> = {
  Smileys: ["😀","😃","😄","😁","😆","😅","🤣","😂","🙂","🙃","😉","😊","😇","🥰","😍","🤩","😘","😗","😚","😙","😋","😛","😜","🤪","😝","🤑","🤗","🤭","🤫","🤔"],
  Gestures: ["👍","👎","👌","🤌","🤏","✌️","🤞","🫰","🤟","🤘","🤙","👈","👉","👆","🖕","👇","☝️","👋","🤚","🖐️","✋","🖖","👏","🙌","👐","🤲","🙏","💪","🫶","🫡"],
  Hearts: ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❣️","💕","💞","💓","💗","💖","💘","💝","💟","♥️","💌","💋","🌹","🌷","💐","💯","🔥","✨","⭐","🌟"],
  Objects: ["🎉","🎊","🎁","🎈","🎂","🍰","🍕","🍔","☕","🍺","🍷","🍾","🎵","🎶","📱","💻","⌨️","🖥️","📷","🎥","📺","📞","📧","💰","💳","💎","🔑","🔒","📌","📎"],
  Reactions: ["😢","😭","😤","😠","😡","🤬","😱","😨","😰","😥","😓","🤗","🤔","🤭","🤥","😶","😐","😑","😬","🙄","😯","😦","😧","😮","😲","🥱","😴","🤤","😪","😵"],
};

const QUICK = ["❤️","👍","😂","😮","😢","🙏"];

export function EmojiPicker({ onPick, quickBar }: { onPick: (e: string) => void; quickBar?: boolean }) {
  const [cat, setCat] = useState<keyof typeof CATEGORIES>("Smileys");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" size="icon" variant="ghost" className="h-9 w-9 rounded-full text-muted-foreground hover:text-primary" aria-label="Emoji">
          <Smile className="h-5 w-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="end">
        {quickBar && (
          <div className="flex gap-1 pb-2 border-b mb-2">
            {QUICK.map((e) => (
              <button key={e} type="button" onClick={() => onPick(e)} className="h-8 w-8 rounded-full hover:bg-accent text-lg transition-transform hover:scale-125">
                {e}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-1 mb-2 overflow-x-auto pb-1">
          {(Object.keys(CATEGORIES) as (keyof typeof CATEGORIES)[]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCat(c)}
              className={cn(
                "text-[10px] px-2 py-1 rounded-full shrink-0 transition-colors",
                cat === c ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-accent"
              )}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-8 gap-1 max-h-56 overflow-y-auto">
          {CATEGORIES[cat].map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => onPick(e)}
              className="h-8 w-8 rounded hover:bg-accent text-lg transition-transform hover:scale-125"
            >
              {e}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export { QUICK as QUICK_REACTIONS };
