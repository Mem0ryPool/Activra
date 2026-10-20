import type { GoalCategory, PlanIcon } from './types'

/**
 * Local achievement template library. Each template recognizes a kind of activity by keywords and
 * gives its icon and five achievement names, one per rarity (common → legendary). To add a kind of
 * activity, add a category in types.ts and a template here; order matters (first match wins), so put
 * specific templates before broad ones.
 */
export interface AchievementTemplate {
  category: GoalCategory
  /** Lowercase substrings; Chinese and English are matched the same way. */
  keywords: string[]
  icon: PlanIcon
  names: { zh: [string, string, string, string, string]; en: [string, string, string, string, string] }
}

export const ACHIEVEMENT_TEMPLATES: readonly AchievementTemplate[] = [
  {
    category: 'vocabulary',
    keywords: ['单词', '词汇', '生词', 'vocabulary', 'vocab', 'words', 'word list', 'flashcard'],
    icon: 'languages',
    names: {
      zh: ['词汇起步', '词汇收集者', '词汇达人', '行走的词典', '万词之王'],
      en: ['First Words', 'Word Collector', 'Vocabulary Builder', 'Walking Dictionary', 'Lexicon Legend']
    }
  },
  {
    category: 'homework',
    keywords: ['作业', '功课', '习题', '试卷', 'homework', 'assignment', 'worksheet', 'problem set'],
    icon: 'notebook-pen',
    names: {
      zh: ['按时交卷', '作业清道夫', '习题克星', '学霸模式', '满分传说'],
      en: ['Handed In', 'Homework Hero', 'Problem Solver', 'Top of the Class', 'Perfect Score']
    }
  },
  {
    category: 'coding',
    keywords: ['python', 'java', 'javascript', 'typescript', 'c++', 'rust', '编程', '代码', '算法', 'leetcode', '力扣', 'coding', 'code', 'programming', 'algorithm'],
    icon: 'code',
    names: {
      zh: ['Hello World', '代码学徒', '算法行者', '全栈工匠', '代码传奇'],
      en: ['Hello World', 'Code Apprentice', 'Algorithm Walker', 'Master Builder', 'Code Legend']
    }
  },
  {
    category: 'language',
    keywords: ['英语', '日语', '韩语', '法语', '德语', '西班牙语', '口语', '听力', '外语', 'english', 'japanese', 'spanish', 'french', 'german', 'korean', 'duolingo', 'language', 'speaking', 'listening'],
    icon: 'languages',
    names: {
      zh: ['开口第一句', '语言学徒', '流利进行时', '语言通', '多语者'],
      en: ['First Phrase', 'Language Learner', 'Getting Fluent', 'Polyglot in Making', 'Polyglot']
    }
  },
  {
    category: 'reading',
    keywords: ['读书', '阅读', '看书', '读完', '页', '章', '小说', 'read', 'book', 'pages', 'chapter', 'novel'],
    icon: 'book-open',
    names: {
      zh: ['翻开一页', '书虫', '阅读达人', '博览群书', '藏书阁主'],
      en: ['First Page', 'Bookworm', 'Avid Reader', 'Well Read', 'Grand Librarian']
    }
  },
  {
    category: 'running',
    keywords: ['跑步', '慢跑', '夜跑', '晨跑', '公里', '马拉松', 'run', 'running', 'jog', 'jogging', 'marathon', 'km', 'miles'],
    icon: 'footprints',
    names: {
      zh: ['迈开步子', '晨跑者', '耐力跑者', '风之子', '马拉松传奇'],
      en: ['First Stride', 'Morning Runner', 'Endurance Runner', 'Wind Runner', 'Marathon Legend']
    }
  },
  {
    category: 'fitness',
    keywords: ['健身', '锻炼', '运动', '训练', '俯卧撑', '仰卧起坐', '深蹲', '平板支撑', '举铁', '游泳', '骑车', '打球', '跳绳', 'gym', 'workout', 'work out', 'exercise', 'training', 'push-up', 'pushup', 'squat', 'plank', 'swim', 'cycling', 'fitness'],
    icon: 'dumbbell',
    names: {
      zh: ['动起来', '健身新秀', '汗水见证', '钢铁意志', '健身传奇'],
      en: ['Getting Moving', 'Gym Rookie', 'Sweat Equity', 'Iron Will', 'Fitness Legend']
    }
  },
  {
    category: 'mindfulness',
    keywords: ['冥想', '瑜伽', '正念', '呼吸', 'meditate', 'meditation', 'yoga', 'mindful', 'breathing'],
    icon: 'flower',
    names: {
      zh: ['静心片刻', '呼吸之间', '心如止水', '禅定', '内心宁静'],
      en: ['A Quiet Moment', 'Breathing Space', 'Calm Mind', 'Deep Focus', 'Inner Peace']
    }
  },
  {
    category: 'sleep',
    keywords: ['早睡', '早起', '睡觉', '睡眠', '起床', '熬夜', 'sleep', 'bed', 'wake up', 'early'],
    icon: 'moon',
    names: {
      zh: ['好梦一晚', '作息调整中', '规律作息', '早起鸟', '作息大师'],
      en: ['Good Night', 'Resetting the Clock', 'Steady Rhythm', 'Early Bird', 'Master of Rest']
    }
  },
  {
    category: 'health',
    keywords: ['喝水', '饮食', '吃早餐', '水果', '蔬菜', '戒糖', '少吃', '减肥', '体重', '吃药', 'water', 'drink', 'diet', 'eat', 'fruit', 'vegetable', 'sugar', 'weight', 'healthy'],
    icon: 'heart-pulse',
    names: {
      zh: ['健康一步', '自律饮食', '元气满满', '身体管理者', '健康传奇'],
      en: ['Healthy Step', 'Mindful Eater', 'Full of Energy', 'Body Keeper', 'Health Legend']
    }
  },
  {
    category: 'writing',
    keywords: ['写作', '日记', '写', '博客', '文章', '论文', 'journal', 'diary', 'write', 'writing', 'blog', 'essay', 'thesis'],
    icon: 'pen-line',
    names: {
      zh: ['落笔', '笔耕不辍', '文字匠人', '妙笔生花', '文坛传奇'],
      en: ['First Line', 'Steady Pen', 'Wordsmith', 'Storyteller', 'Literary Legend']
    }
  },
  {
    category: 'music',
    keywords: ['练琴', '钢琴', '吉他', '小提琴', '唱歌', '乐器', '练声', 'piano', 'guitar', 'violin', 'sing', 'music', 'practice instrument'],
    icon: 'music',
    names: {
      zh: ['第一个音符', '勤练不辍', '旋律掌控者', '演奏家', '音乐传奇'],
      en: ['First Note', 'Daily Practice', 'Melody Maker', 'Virtuoso', 'Music Legend']
    }
  },
  {
    category: 'chores',
    keywords: ['打扫', '整理', '收拾', '洗衣', '做饭', '家务', '断舍离', 'clean', 'tidy', 'laundry', 'cook', 'chores', 'declutter'],
    icon: 'sparkles',
    names: {
      zh: ['焕然一新', '整理能手', '生活家', '井井有条', '收纳大师'],
      en: ['Fresh Start', 'Tidy Hand', 'Home Keeper', 'Everything in Place', 'Master of Order']
    }
  },
  {
    category: 'finance',
    keywords: ['存钱', '记账', '理财', '预算', '省钱', 'save money', 'saving', 'budget', 'expenses', 'invest'],
    icon: 'piggy-bank',
    names: {
      zh: ['第一笔储蓄', '记账达人', '精打细算', '理财高手', '财务自由之路'],
      en: ['First Savings', 'Bookkeeper', 'Smart Spender', 'Money Master', 'Road to Freedom']
    }
  },
  {
    category: 'study',
    keywords: ['学习', '复习', '预习', '考试', '课程', '网课', '数学', '物理', '化学', '背诵', '刷题', 'study', 'review', 'exam', 'course', 'class', 'learn', 'math', 'physics', 'chemistry', 'lesson'],
    icon: 'graduation-cap',
    names: {
      zh: ['开始学习', '勤学者', '学有所成', '学霸', '学识传奇'],
      en: ['Class Begins', 'Diligent Student', 'Quick Learner', 'Scholar', 'Sage']
    }
  },
  {
    category: 'work',
    keywords: ['工作', '项目', '报告', '会议', '简历', '面试', '汇报', 'work', 'project', 'report', 'meeting', 'resume', 'interview', 'presentation'],
    icon: 'briefcase',
    names: {
      zh: ['开工', '执行者', '项目推进者', '效率专家', '职场传奇'],
      en: ['Clocked In', 'Doer', 'Project Driver', 'Efficiency Expert', 'Career Legend']
    }
  }
]

export const GENERAL_TEMPLATE: AchievementTemplate = {
  category: 'general',
  keywords: [],
  icon: 'target',
  names: {
    zh: ['迈出第一步', '说到做到', '坚持者', '自律达人', '人生赢家'],
    en: ['First Step', 'Promise Kept', 'Persistent', 'Self-Discipline', 'Life Champion']
  }
}

export function templateFor(category: GoalCategory): AchievementTemplate {
  return ACHIEVEMENT_TEMPLATES.find((t) => t.category === category) ?? GENERAL_TEMPLATE
}

/** The first template whose keyword appears in the title; 'general' when none does. */
export function categorize(title: string): GoalCategory {
  const text = title.toLowerCase()
  for (const template of ACHIEVEMENT_TEMPLATES) {
    if (template.keywords.some((k) => (/^[a-z +-]+$/.test(k) ? new RegExp(`\\b${k.replace(/[+]/g, '\\+')}`).test(text) : text.includes(k)))) {
      return template.category
    }
  }
  return 'general'
}
