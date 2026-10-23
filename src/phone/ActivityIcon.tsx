import {
  Bed,
  Bike,
  BookOpen,
  BriefcaseBusiness,
  Code,
  Coffee,
  Dumbbell,
  Gamepad2,
  House,
  Leaf,
  Music,
  ScrollText,
} from 'lucide-react';

export function ActivityIcon({ name, size = 23 }: { name: string; size?: number }) {
  const Icon = /学习|读|书|study|read/i.test(name)
    ? BookOpen
    : /实操|编程|开发|code/i.test(name)
      ? Code
      : /工作|work/i.test(name)
        ? BriefcaseBusiness
        : /运动|健身|exercise/i.test(name)
          ? Dumbbell
          : /吃|饭|饮|coffee/i.test(name)
            ? Coffee
            : /休息|睡|sleep|rest/i.test(name)
              ? Bed
              : /通勤|骑|bike/i.test(name)
                ? Bike
                : /娱乐|游戏|刷|game/i.test(name)
                  ? Gamepad2
                  : /音乐|music/i.test(name)
                    ? Music
                    : /日常|生活|life/i.test(name)
                      ? House
                      : /记录|note/i.test(name)
                        ? ScrollText
                        : Leaf;
  return <Icon size={size} strokeWidth={1.65} aria-hidden />;
}
