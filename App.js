import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text as NativeText,
  View,
} from 'react-native';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import { CATEGORIES as CATEGORY_DATA } from './quizData';

const COLORS = {
  background: '#F5F1E8',
  ink: '#20332F',
  muted: '#68746D',
  primary: '#285847',
  paleBlue: '#E4EBE2',
  accent: '#E6B84C',
  terracotta: '#B6533D',
  white: '#FFFCF6',
  line: '#DED9CC',
  success: '#347458',
  successBg: '#E4F0E8',
  error: '#AC4B46',
  errorBg: '#F8E7E2',
};

const READING_SCALE_STEPS = [1, 1.25, 1.5];
const ReadingScaleContext = React.createContext(1);

function Text({ style, ...props }) {
  const readingScale = React.useContext(ReadingScaleContext);
  const flatStyle = StyleSheet.flatten(style);
  if (!flatStyle || readingScale === 1) {
    return <NativeText {...props} style={style} />;
  }

  const scaledStyle = { ...flatStyle };
  if (typeof flatStyle.fontSize === 'number') scaledStyle.fontSize = flatStyle.fontSize * readingScale;
  if (typeof flatStyle.lineHeight === 'number') scaledStyle.lineHeight = flatStyle.lineHeight * readingScale;
  return <NativeText {...props} style={scaledStyle} />;
}

function normalizeReadingScale(value) {
  return READING_SCALE_STEPS.reduce((closest, candidate) => (
    Math.abs(candidate - value) < Math.abs(closest - value) ? candidate : closest
  ), READING_SCALE_STEPS[0]);
}

const SEED_CATEGORIES = CATEGORY_DATA;

async function initializeDatabase(db) {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      short_title TEXT NOT NULL,
      subtitle TEXT NOT NULL,
      icon TEXT NOT NULL,
      color TEXT NOT NULL,
      tint TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY NOT NULL,
      category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      question TEXT NOT NULL,
      options_json TEXT NOT NULL,
      answer_index INTEGER NOT NULL,
      explanation TEXT NOT NULL,
      points INTEGER NOT NULL DEFAULT 10,
      sort_order INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id TEXT NOT NULL REFERENCES categories(id),
      correct_answers INTEGER NOT NULL,
      total_questions INTEGER NOT NULL,
      xp INTEGER NOT NULL,
      completed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS question_responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
      question_id TEXT NOT NULL REFERENCES questions(id),
      selected_index INTEGER NOT NULL,
      selected_text TEXT,
      is_correct INTEGER NOT NULL,
      answered_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS saved_questions (
      question_id TEXT PRIMARY KEY NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      saved_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS daily_challenges (
      day_key TEXT PRIMARY KEY NOT NULL,
      questions_json TEXT NOT NULL,
      completed_at TEXT,
      correct_answers INTEGER,
      current_index INTEGER NOT NULL DEFAULT 0,
      answers_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS app_preferences (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_questions_category ON questions(category_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_attempts_completed ON attempts(completed_at);
    CREATE INDEX IF NOT EXISTS idx_question_responses_review ON question_responses(is_correct, answered_at);
  `);

  const responseColumns = await db.getAllAsync('PRAGMA table_info(question_responses)');
  if (!responseColumns.some((column) => column.name === 'selected_text')) {
    await db.execAsync('ALTER TABLE question_responses ADD COLUMN selected_text TEXT');
  }
  const challengeColumns = await db.getAllAsync('PRAGMA table_info(daily_challenges)');
  if (!challengeColumns.some((column) => column.name === 'current_index')) {
    await db.execAsync('ALTER TABLE daily_challenges ADD COLUMN current_index INTEGER NOT NULL DEFAULT 0');
  }
  if (!challengeColumns.some((column) => column.name === 'answers_json')) {
    await db.execAsync("ALTER TABLE daily_challenges ADD COLUMN answers_json TEXT NOT NULL DEFAULT '[]'");
  }

  await db.withTransactionAsync(async () => {
    for (const category of SEED_CATEGORIES) {
      await db.runAsync(
        `INSERT INTO categories
          (id, title, short_title, subtitle, icon, color, tint, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           short_title = excluded.short_title,
           subtitle = excluded.subtitle,
           icon = excluded.icon,
           color = excluded.color,
           tint = excluded.tint,
           sort_order = excluded.sort_order`,
        category.id,
        category.title,
        category.shortTitle,
        category.subtitle,
        category.icon,
        category.color,
        category.tint,
        category.sortOrder,
      );

      for (let index = 0; index < category.questions.length; index += 1) {
        const item = category.questions[index];
        await db.runAsync(
          `INSERT INTO questions
            (id, category_id, question, options_json, answer_index, explanation, points, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             category_id = excluded.category_id,
             question = excluded.question,
             options_json = excluded.options_json,
             answer_index = excluded.answer_index,
             explanation = excluded.explanation,
             points = excluded.points,
             sort_order = excluded.sort_order`,
          `${category.id}-q${index + 1}`,
          category.id,
          item.question,
          JSON.stringify(item.options),
          item.answerIndex,
          item.explanation,
          10,
          index + 1,
        );
      }
    }
  });

  await db.runAsync(
    `INSERT INTO categories
      (id, title, short_title, subtitle, icon, color, tint, sort_order)
     VALUES ('geral', 'Prática geral', 'Prática geral', 'Questões de todos os temas', 'PG', '#285847', '#E4EBE2', 99)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title, short_title = excluded.short_title,
       subtitle = excluded.subtitle, icon = excluded.icon,
       color = excluded.color, tint = excluded.tint, sort_order = excluded.sort_order`,
  );
  await db.runAsync(
    `INSERT INTO categories
      (id, title, short_title, subtitle, icon, color, tint, sort_order)
     VALUES ('desafio', 'Desafio diário', 'Desafio diário', 'Cinco questões novas por dia', 'DD', '#B6533D', '#F5E5DB', 100)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title, short_title = excluded.short_title,
       subtitle = excluded.subtitle, icon = excluded.icon,
       color = excluded.color, tint = excluded.tint, sort_order = excluded.sort_order`,
  );
}

function dayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function prepareQuestions(rows) {
  return rows.map((row) => {
    const options = JSON.parse(row.options_json).map((text, index) => ({
      text,
      isCorrect: index === row.answer_index,
      originalIndex: index,
    }));
    for (let index = options.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [options[index], options[swapIndex]] = [options[swapIndex], options[index]];
    }
    return {
      ...row,
      options: options.map((option) => option.text),
      option_original_indices: options.map((option) => option.originalIndex),
      answer_index: options.findIndex((option) => option.isCorrect),
    };
  });
}

function calculateStudyStreak(studyDays) {
  const days = new Set(studyDays.map((row) => row.study_day));
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function TabButton({ label, selected, onPress }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.tabButton}
    >
      <View style={[styles.tabIndicator, selected && styles.tabIndicatorSelected]} />
      <Text style={[styles.tabLabel, selected && styles.tabLabelSelected]}>{label}</Text>
    </Pressable>
  );
}

function CivicIllustration({ category, number }) {
  const tone = category.color || COLORS.primary;
  const base = category.tint || COLORS.paleBlue;
  const kind = category.id;
  return (
    <View accessibilityRole="image" accessibilityLabel={`Ilustração abstrata: ${category.title || 'cidadania'}`} style={[styles.civicIllustration, { backgroundColor: base }]}>
      <View style={[styles.artSun, { backgroundColor: `${tone}20` }]} />
      {kind === 'parlamento' && (
        <View style={styles.artBuilding}>
          <View style={[styles.artRoof, { borderBottomColor: tone }]} />
          <View style={[styles.artBeam, { backgroundColor: tone }]} />
          <View style={styles.artColumns}>
            {[0, 1, 2, 3].map((item) => <View key={item} style={[styles.artColumn, { backgroundColor: tone }]} />)}
          </View>
          <View style={[styles.artBase, { backgroundColor: tone }]} />
        </View>
      )}
      {kind === 'democracia' && (
        <View style={styles.artDialogue}>
          <View style={[styles.artBubbleLarge, { backgroundColor: tone }]}>
            <View style={styles.artBubbleDots}><View style={styles.artBubbleDot} /><View style={styles.artBubbleDot} /><View style={styles.artBubbleDot} /></View>
          </View>
          <View style={[styles.artBubbleSmall, { backgroundColor: COLORS.white, borderColor: tone }]}>
            <View style={[styles.artBubbleLine, { backgroundColor: tone }]} />
            <View style={[styles.artBubbleLineShort, { backgroundColor: tone }]} />
          </View>
        </View>
      )}
      {kind === 'direitos' && (
        <View style={styles.artBalance}>
          <View style={[styles.artBalanceBeam, { backgroundColor: tone }]} />
          <View style={[styles.artBalanceStem, { backgroundColor: tone }]} />
          <View style={[styles.artBalancePlate, styles.artBalancePlateLeft, { borderColor: tone }]} />
          <View style={[styles.artBalancePlate, styles.artBalancePlateRight, { borderColor: tone }]} />
          <View style={[styles.artBalanceFoot, { backgroundColor: tone }]} />
        </View>
      )}
      {kind === 'cldf' && (
        <View style={[styles.artDocument, { backgroundColor: COLORS.white, borderColor: `${tone}55` }]}>
          <View style={[styles.artDocumentSeal, { backgroundColor: COLORS.accent }]} />
          <View style={[styles.artDocumentLine, { backgroundColor: tone }]} />
          <View style={[styles.artDocumentLine, styles.artDocumentLineShort, { backgroundColor: `${tone}99` }]} />
          <View style={[styles.artDocumentLine, { backgroundColor: `${tone}70` }]} />
        </View>
      )}
      <View style={styles.illustrationIndex}><Text style={styles.illustrationIndexText}>{number}</Text></View>
    </View>
  );
}

function TrackRow({ category, onPress, plays = 0 }) {
  const number = String(category.sort_order ?? 1).padStart(2, '0');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Jogar: ${category.title || 'trilha de cidadania'}`}
      onPress={onPress}
      style={styles.trackRow}
    >
      <CivicIllustration category={category} number={number} />
      <View style={styles.trackCopy}>
        <Text style={styles.trackTitle} numberOfLines={1}>{category.title || 'Trilha de cidadania'}</Text>
        <Text style={styles.trackSubtitle} numberOfLines={1}>{category.subtitle || 'Conteúdo em atualização'}</Text>
        <Text style={styles.trackMeta}>{category.question_count ?? 0} perguntas{plays ? `  ·  ${plays} ${plays === 1 ? 'partida' : 'partidas'}` : ''}</Text>
      </View>
      <Text style={[styles.trackArrow, { color: category.color }]}>→</Text>
    </Pressable>
  );
}

function QuizApp() {
  const db = useSQLiteContext();
  const [screen, setScreen] = useState('home');
  const [activeTab, setActiveTab] = useState('home');
  const [categories, setCategories] = useState([]);
  const [attemptStats, setAttemptStats] = useState({});
  const [totalXp, setTotalXp] = useState(0);
  const [wrongAnswerCount, setWrongAnswerCount] = useState(0);
  const [savedQuestionCount, setSavedQuestionCount] = useState(0);
  const [dailyCompleted, setDailyCompleted] = useState(false);
  const [dailyStarted, setDailyStarted] = useState(false);
  const [studyStreak, setStudyStreak] = useState(0);
  const [readingScale, setReadingScale] = useState(1);
  const [sessionMode, setSessionMode] = useState('track');
  const [sessionDay, setSessionDay] = useState(null);
  const [savedQuestionIds, setSavedQuestionIds] = useState(new Set());
  const [reviewItems, setReviewItems] = useState([]);
  const [reviewMode, setReviewMode] = useState('missed');
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState(null);
  const [answerSubmitted, setAnswerSubmitted] = useState(false);
  const [answers, setAnswers] = useState([]);
  const [result, setResult] = useState(null);
  const [savingResult, setSavingResult] = useState(false);
  const savingResultRef = useRef(false);

  const refreshDashboard = useCallback(async () => {
    const categoryRows = await db.getAllAsync(
      `SELECT c.id, c.title, c.short_title, c.subtitle, c.icon, c.color, c.tint, c.sort_order,
              COUNT(q.id) AS question_count
         FROM categories c LEFT JOIN questions q ON q.category_id = c.id
        GROUP BY c.id ORDER BY c.sort_order`,
    );
    const attemptRows = await db.getAllAsync(
      `SELECT category_id, COUNT(*) AS plays, SUM(correct_answers) AS correct,
              SUM(total_questions) AS answered, MAX(completed_at) AS last_played
         FROM attempts GROUP BY category_id`,
    );
    const xpRow = await db.getFirstAsync('SELECT COALESCE(SUM(xp), 0) AS total_xp FROM attempts');
    const reviewCounts = await db.getFirstAsync(
      `SELECT
         (SELECT COUNT(*) FROM question_responses r
           WHERE r.is_correct = 0
             AND r.id = (SELECT MAX(r2.id) FROM question_responses r2 WHERE r2.question_id = r.question_id)
         ) AS wrong_count,
         (SELECT COUNT(*) FROM saved_questions) AS saved_count`,
    );
    const todayChallenge = await db.getFirstAsync(
      'SELECT questions_json, completed_at FROM daily_challenges WHERE day_key = ?',
      dayKey(),
    );
    const studyDays = await db.getAllAsync(
      `SELECT DISTINCT date(completed_at, 'localtime') AS study_day
         FROM attempts ORDER BY study_day DESC`,
    );
    const readingPreference = await db.getFirstAsync(
      "SELECT value FROM app_preferences WHERE key = 'reading_scale'",
    );
    const stats = {};
    for (const row of attemptRows) stats[row.category_id] = row;
    setCategories(categoryRows);
    setAttemptStats(stats);
    setTotalXp(xpRow?.total_xp ?? 0);
    setWrongAnswerCount(reviewCounts?.wrong_count ?? 0);
    setSavedQuestionCount(reviewCounts?.saved_count ?? 0);
    setDailyCompleted(Boolean(todayChallenge?.completed_at));
    setDailyStarted(Boolean(todayChallenge?.questions_json) && !todayChallenge?.completed_at);
    setStudyStreak(calculateStudyStreak(studyDays));
    setReadingScale(normalizeReadingScale(Number(readingPreference?.value) || 1));
    setLoading(false);
  }, [db]);

  useEffect(() => {
    refreshDashboard().catch((error) => {
      console.error('Não foi possível carregar o conteúdo do quiz.', error);
      setLoading(false);
    });
  }, [refreshDashboard]);

  const currentLevel = Math.floor(totalXp / 100) + 1;
  const levelProgress = (totalXp % 100) / 100;
  const visibleCategories = categories.filter((category) => category.id !== 'geral' && category.id !== 'desafio');
  const firstCategory = visibleCategories[0];
  const questionTotal = categories.reduce((sum, category) => sum + category.question_count, 0);

  const startQuiz = useCallback(async (category) => {
    if (!category) return;
    const rows = await db.getAllAsync(
      `SELECT q.id, q.question, q.options_json, q.answer_index, q.explanation, q.points,
              c.short_title AS category_short_title
         FROM questions q JOIN categories c ON c.id = q.category_id
        WHERE q.category_id = ? ORDER BY q.sort_order`,
      category.id,
    );
    const savedRows = await db.getAllAsync('SELECT question_id FROM saved_questions');
    setSavedQuestionIds(new Set(savedRows.map((row) => row.question_id)));
    setSelectedCategory(category);
    setQuestions(prepareQuestions(rows));
    setSessionMode('track');
    setSessionDay(null);
    setQuestionIndex(0);
    setSelectedOption(null);
    setAnswerSubmitted(false);
    setAnswers([]);
    setResult(null);
    setSavingResult(false);
    savingResultRef.current = false;
    setScreen('quiz');
  }, [db]);

  const startPractice = async (amount = 10) => {
    const rows = await db.getAllAsync(
      `SELECT q.id, q.question, q.options_json, q.answer_index, q.explanation, q.points,
              c.short_title AS category_short_title
         FROM questions q JOIN categories c ON c.id = q.category_id
        ORDER BY RANDOM() LIMIT ?`,
      amount,
    );
    const savedRows = await db.getAllAsync('SELECT question_id FROM saved_questions');
    setSavedQuestionIds(new Set(savedRows.map((row) => row.question_id)));
    setSelectedCategory({ id: 'geral', title: 'Prática geral', short_title: 'Prática geral', question_count: rows.length });
    setQuestions(prepareQuestions(rows));
    setSessionMode('practice');
    setSessionDay(null);
    setQuestionIndex(0);
    setSelectedOption(null);
    setAnswerSubmitted(false);
    setAnswers([]);
    setResult(null);
    setSavingResult(false);
    savingResultRef.current = false;
    setScreen('quiz');
  };

  const startDailyChallenge = async () => {
    const today = dayKey();
    let challenge = await db.getFirstAsync(
      'SELECT questions_json, completed_at, current_index, answers_json FROM daily_challenges WHERE day_key = ?',
      today,
    );
    if (challenge?.completed_at) {
      setDailyCompleted(true);
      return;
    }

    let questionIds = challenge ? JSON.parse(challenge.questions_json) : null;
    if (!questionIds?.length) {
      const randomQuestions = await db.getAllAsync('SELECT id FROM questions ORDER BY RANDOM() LIMIT 5');
      questionIds = randomQuestions.map((row) => row.id);
      if (!questionIds.length) return;
      await db.runAsync(
        'INSERT OR REPLACE INTO daily_challenges (day_key, questions_json, completed_at, correct_answers) VALUES (?, ?, NULL, NULL)',
        today,
        JSON.stringify(questionIds),
      );
      setDailyStarted(true);
    }

    const placeholders = questionIds.map(() => '?').join(',');
    const rows = await db.getAllAsync(
      `SELECT q.id, q.question, q.options_json, q.answer_index, q.explanation, q.points,
              c.short_title AS category_short_title
         FROM questions q JOIN categories c ON c.id = q.category_id
        WHERE q.id IN (${placeholders})`,
      ...questionIds,
    );
    const rowById = new Map(rows.map((row) => [row.id, row]));
    const orderedRows = questionIds.map((id) => rowById.get(id)).filter(Boolean);
    const savedRows = await db.getAllAsync('SELECT question_id FROM saved_questions');
    setSavedQuestionIds(new Set(savedRows.map((row) => row.question_id)));
    setSelectedCategory({ id: 'desafio', title: 'Desafio do dia', short_title: 'Desafio diário', question_count: orderedRows.length });
    setQuestions(prepareQuestions(orderedRows));
    setSessionMode('daily');
    setSessionDay(today);
    const resumeIndex = Math.min(Number(challenge?.current_index) || 0, Math.max(0, orderedRows.length - 1));
    const restoredAnswers = JSON.parse(challenge?.answers_json || '[]');
    setQuestionIndex(resumeIndex);
    setSelectedOption(null);
    setAnswerSubmitted(false);
    setAnswers(restoredAnswers);
    setResult(null);
    setSavingResult(false);
    savingResultRef.current = false;
    setScreen('quiz');
  };

  const updateReadingScale = async (nextScale) => {
    const scale = normalizeReadingScale(nextScale);
    setReadingScale(scale);
    try {
      await db.runAsync(
        "INSERT OR REPLACE INTO app_preferences (key, value) VALUES ('reading_scale', ?)",
        String(scale),
      );
    } catch (error) {
      console.error('Não foi possível salvar o tamanho da leitura.', error);
    }
  };

  const chooseTab = (tab) => {
    setActiveTab(tab);
    setScreen(tab);
  };

  const toggleSavedQuestion = async (questionId) => {
    if (!questionId) return;
    const wasSaved = savedQuestionIds.has(questionId);
    try {
      if (wasSaved) {
        await db.runAsync('DELETE FROM saved_questions WHERE question_id = ?', questionId);
      } else {
        await db.runAsync(
          'INSERT OR IGNORE INTO saved_questions (question_id, saved_at) VALUES (?, ?)',
          questionId,
          new Date().toISOString(),
        );
      }
      setSavedQuestionIds((previous) => {
        const next = new Set(previous);
        if (wasSaved) next.delete(questionId);
        else next.add(questionId);
        return next;
      });
      if (wasSaved && screen === 'review' && reviewMode === 'saved') {
        setReviewItems((previous) => previous.filter((item) => item.id !== questionId));
      }
      await refreshDashboard();
    } catch (error) {
      console.error('Não foi possível atualizar as questões salvas.', error);
    }
  };

  const openReview = async (mode) => {
    const rows = mode === 'saved'
      ? await db.getAllAsync(
        `SELECT q.id, q.question, q.options_json, q.answer_index, q.explanation,
                c.title AS category_title, c.color AS category_color,
                NULL AS selected_index, NULL AS is_correct, s.saved_at AS answered_at
           FROM saved_questions s
           JOIN questions q ON q.id = s.question_id
           JOIN categories c ON c.id = q.category_id
          ORDER BY s.saved_at DESC`,
      )
      : await db.getAllAsync(
        `SELECT q.id, q.question, q.options_json, q.answer_index, q.explanation,
                c.title AS category_title, c.color AS category_color,
                r.selected_index, r.selected_text, r.is_correct, r.answered_at
           FROM question_responses r
           JOIN questions q ON q.id = r.question_id
           JOIN categories c ON c.id = q.category_id
          WHERE r.is_correct = 0
            AND r.id = (
              SELECT MAX(r2.id) FROM question_responses r2
               WHERE r2.question_id = r.question_id
            )
          ORDER BY r.answered_at DESC
          LIMIT 60`,
      );
    const savedRows = await db.getAllAsync('SELECT question_id FROM saved_questions');
    setSavedQuestionIds(new Set(savedRows.map((row) => row.question_id)));
    setReviewItems(rows.map((row) => ({ ...row, options: JSON.parse(row.options_json) })));
    setReviewMode(mode);
    setScreen('review');
  };

  const handleNextQuestion = async () => {
    if (selectedOption === null || !questions[questionIndex] || savingResultRef.current) return;
    const currentQuestion = questions[questionIndex];
    const nextAnswers = [...answers, {
      questionId: currentQuestion.id,
      selectedIndex: currentQuestion.option_original_indices?.[selectedOption] ?? selectedOption,
      selectedText: currentQuestion.options[selectedOption],
      correct: selectedOption === currentQuestion.answer_index,
    }];
    setAnswers(nextAnswers);

    if (questionIndex < questions.length - 1) {
      if (sessionMode === 'daily' && sessionDay) {
        try {
          await db.runAsync(
            'UPDATE daily_challenges SET current_index = ?, answers_json = ? WHERE day_key = ?',
            questionIndex + 1,
            JSON.stringify(nextAnswers),
            sessionDay,
          );
        } catch (error) {
          console.error('Não foi possível salvar o avanço do desafio diário.', error);
        }
      }
      setQuestionIndex(questionIndex + 1);
      setSelectedOption(null);
      setAnswerSubmitted(false);
      return;
    }

    const correctCount = nextAnswers.filter((answer) => answer.correct).length;
    const dailyBonus = sessionMode === 'daily' ? 20 : 0;
    const earnedXp = correctCount * 10 + dailyBonus;
    savingResultRef.current = true;
    setSavingResult(true);
    try {
      await db.withTransactionAsync(async () => {
        const completedAt = new Date().toISOString();
        const attempt = await db.runAsync(
          `INSERT INTO attempts (category_id, correct_answers, total_questions, xp, completed_at)
           VALUES (?, ?, ?, ?, ?)`,
          selectedCategory.id,
          correctCount,
          questions.length,
          earnedXp,
          completedAt,
        );
        for (const answer of nextAnswers) {
          await db.runAsync(
            `INSERT INTO question_responses
              (attempt_id, question_id, selected_index, selected_text, is_correct, answered_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            attempt.lastInsertRowId,
            answer.questionId,
            answer.selectedIndex,
            answer.selectedText,
            answer.correct ? 1 : 0,
            completedAt,
          );
        }
        if (sessionMode === 'daily' && sessionDay) {
          await db.runAsync(
            `UPDATE daily_challenges
                SET completed_at = ?, correct_answers = ?
              WHERE day_key = ? AND completed_at IS NULL`,
            completedAt,
            correctCount,
            sessionDay,
          );
        }
      });
      await refreshDashboard();
    } catch (error) {
      console.error('Não foi possível salvar esta partida.', error);
    } finally {
      savingResultRef.current = false;
      setSavingResult(false);
    }
    setResult({ correctCount, total: questions.length, earnedXp });
    setScreen('result');
  };

  if (loading) {
    return (
      <ReadingScaleContext.Provider value={readingScale}>
        <View style={styles.loadingScreen}>
          <ActivityIndicator color={COLORS.primary} size="large" />
          <Text style={styles.loadingLabel}>Preparando sua trilha...</Text>
        </View>
      </ReadingScaleContext.Provider>
    );
  }

  const renderHome = () => (
    <ScrollView contentContainerStyle={styles.homeContent} showsVerticalScrollIndicator={false}>
      <View style={styles.brandBar}>
        <View style={styles.brandLockup}>
          <View style={styles.brandStamp}><Text style={styles.brandStampText}>CJ</Text></View>
          <View>
            <Text style={styles.brandOverline}>NPE · CIDADANIA NO DF</Text>
            <Text style={styles.brandName}>Cidadania em jogo</Text>
          </View>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Abrir meu perfil" onPress={() => chooseTab('profile')} style={styles.headerXp}>
          <Text style={styles.headerXpValue}>{totalXp}</Text>
          <Text style={styles.headerXpLabel}>XP</Text>
        </Pressable>
      </View>

      <View style={styles.homeIntro}>
        <Text style={styles.eyebrow}>UM JOGO SOBRE A VIDA PÚBLICA</Text>
        <Text style={styles.homeTitle}>A cidade também{ '\n' }se decide na conversa.</Text>
        <Text style={styles.homeDescription}>Histórias do dia a dia ajudam a entender leis, direitos e as escolhas que moldam o Distrito Federal.</Text>
      </View>

      <Pressable accessibilityRole="button" onPress={() => startQuiz(firstCategory)} style={styles.featureCard}>
        <View style={styles.featureTopline}>
          <Text style={styles.featureLabel}>PARA COMEÇAR</Text>
          <Text style={styles.featureNumber}>01 / 04</Text>
        </View>
        <View style={styles.featureMain}>
        <View style={styles.featureCopy}>
            <Text style={styles.featureTitle}>{firstCategory?.title || 'Parlamento'}</Text>
            <Text style={styles.featureDescription}>Veja como propostas viram debate — e como a população pode acompanhar o caminho.</Text>
          </View>
          <Text style={styles.featureOrdinal}>01</Text>
        </View>
        <View style={styles.featureFooter}>
          <Text style={styles.featureMeta}>{firstCategory?.question_count ?? 0} perguntas  ·  cerca de 8 min</Text>
          <View style={styles.featureAction}><Text style={styles.featureActionText}>Começar trilha  →</Text></View>
        </View>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: dailyCompleted }}
        disabled={dailyCompleted}
        onPress={startDailyChallenge}
        style={[styles.dailyCard, dailyCompleted && styles.dailyCardDone]}
      >
        <View style={styles.dailyCardTop}><Text style={styles.dailyEyebrow}>DESAFIO DO DIA</Text><Text style={styles.dailyBonus}>{dailyCompleted ? 'FEITO' : '+20 XP'}</Text></View>
        <Text style={styles.dailyTitle}>{dailyCompleted ? 'Missão concluída. Até amanhã.' : dailyStarted ? 'Retome seu desafio.' : 'Cinco perguntas, vários temas.'}</Text>
        <Text style={styles.dailyDescription}>{dailyCompleted ? 'Seu desafio de hoje já entrou no seu percurso.' : dailyStarted ? 'Seu progresso está guardado neste aparelho.' : 'Um pequeno percurso novo por dia, salvo para você continuar depois.'}</Text>
        <View style={styles.dailyAction}><Text style={styles.dailyActionText}>{dailyCompleted ? 'Concluído hoje' : dailyStarted ? 'Continuar desafio  →' : 'Começar desafio  →'}</Text></View>
      </Pressable>

      <View style={styles.progressBand}>
        <View style={styles.progressBandHeader}>
          <View>
            <Text style={styles.progressBandLabel}>SEU PERCURSO</Text>
            <Text style={styles.progressBandTitle}>Nível {currentLevel} <Text style={styles.progressBandMuted}>· {totalXp} XP</Text></Text>
          </View>
          <Text style={styles.progressBandNext}>{100 - (totalXp % 100)} XP até o próximo nível</Text>
        </View>
        <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.max(4, levelProgress * 100)}%` }]} /></View>
      </View>

      <View style={styles.reviewShortcutHeading}>
        <Text style={styles.sectionEyebrow}>CONTINUE DE ONDE PAROU</Text>
      </View>
      <View style={styles.reviewShortcutRow}>
        <Pressable accessibilityRole="button" onPress={() => openReview('missed')} style={styles.reviewShortcut}>
          <View style={[styles.reviewShortcutMark, { backgroundColor: COLORS.errorBg }]}><Text style={[styles.reviewShortcutMarkText, { color: COLORS.error }]}>!</Text></View>
          <View style={styles.reviewShortcutCopy}><Text style={styles.reviewShortcutTitle}>Rever respostas</Text><Text style={styles.reviewShortcutMeta}>{wrongAnswerCount} para revisar</Text></View>
          <Text style={styles.reviewShortcutArrow}>→</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => openReview('saved')} style={styles.reviewShortcut}>
          <View style={[styles.reviewShortcutMark, { backgroundColor: '#F3E5C3' }]}><Text style={[styles.reviewShortcutMarkText, { color: COLORS.primary }]}>Q</Text></View>
          <View style={styles.reviewShortcutCopy}><Text style={styles.reviewShortcutTitle}>Questões salvas</Text><Text style={styles.reviewShortcutMeta}>{savedQuestionCount} no caderno</Text></View>
          <Text style={styles.reviewShortcutArrow}>→</Text>
        </Pressable>
      </View>

      <View style={styles.sectionHeading}>
        <View>
          <Text style={styles.sectionEyebrow}>QUATRO TEMAS</Text>
          <Text style={styles.sectionTitle}>O que você quer descobrir?</Text>
        </View>
        <Text style={styles.sectionCount}>{questionTotal} perguntas</Text>
      </View>
      <View style={styles.trackList}>
        {visibleCategories.map((category) => (
          <TrackRow key={category.id} category={category} plays={attemptStats[category.id]?.plays || 0} onPress={() => startQuiz(category)} />
        ))}
      </View>

      <View style={styles.noteBlock}>
        <Text style={styles.noteLabel}>PARA LEVAR COM VOCÊ</Text>
        <Text style={styles.noteText}>Participar também é acompanhar, perguntar e entender como uma decisão pública é construída.</Text>
      </View>
      <Text style={styles.noteSource}>Ilustrações abstratas, sem fotografias.</Text>
    </ScrollView>
  );

  const renderExplore = () => (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <View style={styles.pageHeader}>
        <Text style={styles.eyebrow}>BIBLIOTECA DE TRILHAS</Text>
        <Text style={styles.pageTitle}>Explore no seu ritmo.</Text>
        <Text style={styles.pageSub}>{questionTotal} perguntas para explorar o Parlamento, a democracia, os direitos e a CLDF.</Text>
      </View>
      <View style={styles.trackList}>
        <View style={styles.practicePanel}>
          <Text style={styles.practiceEyebrow}>PRÁTICA MISTA</Text>
          <Text style={styles.practiceTitle}>Treine entre os temas.</Text>
          <Text style={styles.practiceDescription}>As perguntas são escolhidas de todas as trilhas e embaralhadas a cada sessão.</Text>
          <View style={styles.practiceActions}>
            <Pressable accessibilityRole="button" onPress={() => startPractice(5)} style={styles.practiceButton}><Text style={styles.practiceButtonValue}>5</Text><Text style={styles.practiceButtonLabel}>questões</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={() => startPractice(10)} style={[styles.practiceButton, styles.practiceButtonSelected]}><Text style={[styles.practiceButtonValue, styles.practiceButtonValueSelected]}>10</Text><Text style={[styles.practiceButtonLabel, styles.practiceButtonLabelSelected]}>questões</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={() => startPractice(20)} style={styles.practiceButton}><Text style={styles.practiceButtonValue}>20</Text><Text style={styles.practiceButtonLabel}>questões</Text></Pressable>
          </View>
        </View>
        {visibleCategories.map((category) => (
          <TrackRow key={category.id} category={category} plays={attemptStats[category.id]?.plays || 0} onPress={() => startQuiz(category)} />
        ))}
      </View>
      <View style={styles.noteBlock}>
        <Text style={styles.noteLabel}>COMO FUNCIONA</Text>
        <Text style={styles.noteText}>Cada trilha combina situações do cotidiano com explicações sobre as instituições e a participação cidadã.</Text>
      </View>
    </ScrollView>
  );

  const renderProfile = () => (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <View style={styles.pageHeader}>
        <Text style={styles.eyebrow}>CADERNO DE ATIVIDADE</Text>
        <Text style={styles.pageTitle}>O que você já descobriu.</Text>
        <Text style={styles.pageSub}>Um registro do que você já explorou por aqui.</Text>
      </View>
      <View style={styles.profileSummary}>
        <View><Text style={styles.profileSummaryLabel}>PONTOS ACUMULADOS</Text><Text style={styles.profileTotalXp}>{totalXp}<Text style={styles.profileXpSuffix}> XP</Text></Text></View>
        <View style={styles.profileLevelTag}><Text style={styles.profileLevelTagLabel}>NÍVEL</Text><Text style={styles.profileLevelTagValue}>{String(currentLevel).padStart(2, '0')}</Text></View>
      </View>
      <View style={styles.streakPanel}>
        <View style={styles.streakMark}><Text style={styles.streakMarkText}>{String(studyStreak).padStart(2, '0')}</Text></View>
        <View style={styles.streakCopy}><Text style={styles.streakTitle}>{studyStreak === 1 ? 'Dia de estudo seguido' : 'Dias de estudo seguidos'}</Text><Text style={styles.streakDescription}>Continue aprendendo no seu ritmo. Trilhas e práticas concluídas contam.</Text></View>
      </View>
      <View style={styles.statRow}>
        <View style={styles.statCard}><Text style={styles.statValue}>{Object.values(attemptStats).reduce((sum, item) => sum + item.plays, 0)}</Text><Text style={styles.statLabel}>partidas{ '\n' }concluídas</Text></View>
        <View style={styles.statCard}><Text style={styles.statValue}>{Object.keys(attemptStats).filter((id) => id !== 'geral' && id !== 'desafio').length}</Text><Text style={styles.statLabel}>temas{ '\n' }visitados</Text></View>
        <View style={styles.statCard}><Text style={styles.statValue}>{Object.values(attemptStats).reduce((sum, item) => sum + item.correct, 0)}</Text><Text style={styles.statLabel}>respostas{ '\n' }certas</Text></View>
      </View>
      <View style={styles.profileTools}>
        <Pressable accessibilityRole="button" onPress={() => openReview('missed')} style={styles.profileToolButton}>
          <Text style={styles.profileToolTitle}>Rever respostas</Text>
          <Text style={styles.profileToolMeta}>{wrongAnswerCount} questões aguardando revisão</Text>
          <Text style={styles.profileToolArrow}>→</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => openReview('saved')} style={styles.profileToolButton}>
          <Text style={styles.profileToolTitle}>Caderno de questões</Text>
          <Text style={styles.profileToolMeta}>{savedQuestionCount} questões guardadas</Text>
          <Text style={styles.profileToolArrow}>→</Text>
        </Pressable>
      </View>
      <View style={styles.accessibilityPanel}>
        <Text style={styles.sectionEyebrow}>ACESSIBILIDADE</Text>
        <Text style={styles.accessibilityTitle}>Ajuste o tamanho da leitura</Text>
        <Text style={styles.accessibilityDescription}>O ajuste acompanha todo o app, incluindo perguntas, alternativas e explicações.</Text>
        <View style={styles.accessibilityControls}>
          <Pressable accessibilityRole="button" accessibilityLabel="Diminuir tamanho do texto" disabled={readingScale <= READING_SCALE_STEPS[0]} onPress={() => updateReadingScale(READING_SCALE_STEPS[Math.max(0, READING_SCALE_STEPS.indexOf(readingScale) - 1)])} style={[styles.textScaleButton, readingScale <= READING_SCALE_STEPS[0] && styles.textScaleButtonDisabled]}><Text style={[styles.textScaleButtonText, readingScale <= READING_SCALE_STEPS[0] && styles.textScaleButtonTextDisabled]}>A−</Text></Pressable>
          <Text style={styles.textScaleValue}>{Math.round(readingScale * 100)}%</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Aumentar tamanho do texto" disabled={readingScale >= READING_SCALE_STEPS[READING_SCALE_STEPS.length - 1]} onPress={() => updateReadingScale(READING_SCALE_STEPS[Math.min(READING_SCALE_STEPS.length - 1, READING_SCALE_STEPS.indexOf(readingScale) + 1)])} style={[styles.textScaleButton, readingScale >= READING_SCALE_STEPS[READING_SCALE_STEPS.length - 1] && styles.textScaleButtonDisabled]}><Text style={[styles.textScaleButtonText, readingScale >= READING_SCALE_STEPS[READING_SCALE_STEPS.length - 1] && styles.textScaleButtonTextDisabled]}>A+</Text></Pressable>
        </View>
        <View style={styles.accessibilityPreview}>
          <Text style={styles.accessibilityPreviewText}>Participar também é entender como uma decisão pública é construída.</Text>
        </View>
      </View>
      <View style={styles.profileSectionHeader}><Text style={styles.sectionEyebrow}>ATIVIDADE POR TEMA E MODO</Text><Text style={styles.profileSectionHint}>O histórico fica neste aparelho.</Text></View>
      <View style={styles.activityList}>
        {categories.map((category) => {
          const stats = attemptStats[category.id];
          return (
            <View key={category.id} style={styles.activityRow}>
              <View style={[styles.activityMarker, { backgroundColor: category.color }]} />
              <View style={styles.activityCopy}><Text style={styles.activityTitle}>{category.short_title}</Text><Text style={styles.activityMeta}>{stats?.plays || 0} {stats?.plays === 1 ? 'partida' : 'partidas'}</Text></View>
              <Text style={styles.activityScore}>{stats?.correct || 0}<Text style={styles.activityScoreMuted}> acertos</Text></Text>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );

  const renderQuiz = () => {
    const question = questions[questionIndex];
    if (!question) {
      return (
        <View style={styles.quizEmptyState}>
          <Text style={styles.emptyStateEyebrow}>TRILHA INDISPONÍVEL</Text>
          <Text style={styles.emptyStateTitle}>Ainda não há perguntas nesta trilha.</Text>
          <Pressable onPress={() => { setActiveTab('explore'); setScreen('explore'); }} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Voltar às trilhas</Text><Text style={styles.primaryButtonArrow}>→</Text>
          </Pressable>
        </View>
      );
    }
    const progress = ((questionIndex + (answerSubmitted ? 1 : 0)) / questions.length) * 100;
    return (
      <View style={styles.quizScreen}>
        <View style={styles.quizTop}>
          <Pressable accessibilityRole="button" accessibilityLabel="Voltar para as trilhas" onPress={() => setScreen(activeTab)} style={styles.backButton}><Text style={styles.backIcon}>←</Text></Pressable>
          <View style={styles.quizTopCopy}><Text style={styles.quizTopLabel}>{sessionMode === 'daily' ? 'DESAFIO DO DIA' : sessionMode === 'practice' ? 'PRÁTICA MISTA' : 'TRILHA'}</Text><Text style={styles.quizTopic}>{selectedCategory?.short_title || 'Cidadania'}</Text></View>
          <Text style={styles.quizCount}>{String(questionIndex + 1).padStart(2, '0')}<Text style={styles.quizCountMuted}> / {String(questions.length).padStart(2, '0')}</Text></Text>
        </View>
        <View style={styles.quizProgressTrack}><View style={[styles.quizProgressFill, { width: `${progress}%` }]} /></View>
        <ScrollView contentContainerStyle={styles.quizContent} showsVerticalScrollIndicator={false}>
          <View style={styles.questionOverline}>
            <View style={styles.questionOverlineCopy}><Text style={styles.missionPillText}>{sessionMode === 'track' ? `PERGUNTA ${String(questionIndex + 1).padStart(2, '0')}` : question.category_short_title || 'QUESTÃO MISTA'}</Text><Text style={styles.questionTotal}>{String(questionIndex + 1).padStart(2, '0')} DE {String(questions.length).padStart(2, '0')}</Text></View>
            <Pressable accessibilityRole="button" accessibilityState={{ selected: savedQuestionIds.has(question.id) }} onPress={() => toggleSavedQuestion(question.id)} style={[styles.saveQuestionButton, savedQuestionIds.has(question.id) && styles.saveQuestionButtonActive]}>
              <Text style={[styles.saveQuestionText, savedQuestionIds.has(question.id) && styles.saveQuestionTextActive]}>{savedQuestionIds.has(question.id) ? 'Salva' : 'Salvar'}</Text>
            </Pressable>
          </View>
          <Text style={styles.questionTitle}>{question.question || 'Enunciado indisponível.'}</Text>
          <Text style={styles.questionHint}>Qual alternativa parece mais adequada para essa situação?</Text>
          <View style={styles.optionsList}>
            {question.options.map((option, index) => {
              const isSelected = selectedOption === index;
              const isCorrect = index === question.answer_index;
              const showCorrect = answerSubmitted && isCorrect;
              const showWrong = answerSubmitted && isSelected && !isCorrect;
              return (
                <Pressable
                  key={`${question.id}-${index}`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: isSelected, disabled: answerSubmitted }}
                  disabled={answerSubmitted}
                  onPress={() => setSelectedOption(index)}
                  style={[
                    styles.optionCard,
                    isSelected && !answerSubmitted && styles.optionSelected,
                    showCorrect && styles.optionCorrect,
                    showWrong && styles.optionWrong,
                  ]}
                >
                  <View style={[styles.optionLetter, isSelected && !answerSubmitted && styles.optionLetterSelected, showCorrect && styles.optionLetterCorrect, showWrong && styles.optionLetterWrong]}>
                    <Text style={[styles.optionLetterText, (isSelected || showCorrect || showWrong) && styles.optionLetterTextActive]}>{showCorrect ? '✓' : String.fromCharCode(65 + index)}</Text>
                  </View>
                  <Text style={styles.optionText}>{option || 'Alternativa indisponível.'}</Text>
                </Pressable>
              );
            })}
          </View>
          {answerSubmitted && (
            <View style={[styles.feedbackCard, selectedOption === question.answer_index ? styles.feedbackCorrect : styles.feedbackIncorrect]}>
              <Text style={styles.feedbackTitle}>{selectedOption === question.answer_index ? 'Mandou bem!' : 'Quase! Vamos aprender juntos.'}</Text>
          <Text style={styles.feedbackBody}>{question.explanation || 'Não há explicação disponível para esta pergunta.'}</Text>
            </View>
          )}
        </ScrollView>
        <View style={styles.quizFooter}>
          {!answerSubmitted ? (
            <Pressable disabled={selectedOption === null} onPress={() => setAnswerSubmitted(true)} style={[styles.primaryButton, selectedOption === null && styles.primaryButtonDisabled]}>
              <Text style={[styles.primaryButtonText, selectedOption === null && styles.primaryButtonDisabledText]}>Conferir resposta</Text><Text style={[styles.primaryButtonArrow, selectedOption === null && styles.primaryButtonDisabledText]}>→</Text>
            </Pressable>
          ) : (
            <Pressable onPress={handleNextQuestion} disabled={savingResult} style={[styles.primaryButton, savingResult && styles.primaryButtonDisabled]}>
              <Text style={[styles.primaryButtonText, savingResult && styles.primaryButtonDisabledText]}>{savingResult ? 'Salvando...' : questionIndex === questions.length - 1 ? 'Ver resumo' : 'Continuar'}</Text><Text style={[styles.primaryButtonArrow, savingResult && styles.primaryButtonDisabledText]}>→</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  };

  const renderReview = () => {
    const isSavedReview = reviewMode === 'saved';
    return (
      <ScrollView contentContainerStyle={styles.reviewScreen} showsVerticalScrollIndicator={false}>
        <View style={styles.reviewHeader}>
          <Pressable accessibilityRole="button" accessibilityLabel="Voltar" onPress={() => setScreen(activeTab)} style={styles.backButton}><Text style={styles.backIcon}>←</Text></Pressable>
          <View style={styles.reviewHeaderCopy}>
            <Text style={styles.eyebrow}>{isSavedReview ? 'SEU CADERNO' : 'REVISÃO DE APRENDIZADO'}</Text>
            <Text style={styles.pageTitle}>{isSavedReview ? 'Questões salvas' : 'Vamos revisar.'}</Text>
          </View>
        </View>
        <Text style={styles.pageSub}>{isSavedReview ? 'Guarde assuntos para reler quando quiser.' : 'Revise a resposta mais recente de cada questão que ficou em dúvida.'}</Text>
        {reviewItems.length === 0 ? (
          <View style={styles.emptyReviewCard}>
          <View style={styles.emptyReviewMark}><Text style={styles.emptyReviewMarkText}>{isSavedReview ? 'Q' : 'OK'}</Text></View>
            <Text style={styles.emptyReviewTitle}>{isSavedReview ? 'Seu caderno está vazio.' : 'Tudo em dia por aqui.'}</Text>
            <Text style={styles.emptyReviewBody}>{isSavedReview ? 'Durante uma trilha, toque em “Salvar” para guardar uma questão.' : 'As respostas que você revisar depois aparecerão nesta área.'}</Text>
            <Pressable onPress={() => { setActiveTab('explore'); setScreen('explore'); }} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Explorar trilhas</Text></Pressable>
          </View>
        ) : reviewItems.map((item) => {
          const saved = savedQuestionIds.has(item.id);
          return (
            <View key={item.id} style={styles.reviewCard}>
              <View style={styles.reviewCardTop}>
                <Text style={[styles.reviewCategory, { color: item.category_color || COLORS.primary }]}>{item.category_title || 'Trilha de cidadania'}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={saved ? 'Remover do caderno' : 'Salvar no caderno'} onPress={() => toggleSavedQuestion(item.id)} style={styles.reviewSaveButton}>
                  <Text style={[styles.reviewSaveText, saved && styles.reviewSaveTextActive]}>{saved ? 'Salva' : 'Salvar'}</Text>
                </Pressable>
              </View>
              <Text style={styles.reviewQuestion}>{item.question || 'Questão sem enunciado.'}</Text>
              {!isSavedReview && item.selected_index !== null && item.selected_index !== undefined && (
                <View style={styles.reviewAnswerRow}>
                  <Text style={styles.reviewAnswerLabel}>SUA RESPOSTA</Text>
                  <Text style={styles.reviewWrongAnswer}>{item.selected_text || 'Resposta registrada antes da atualização'}</Text>
                </View>
              )}
              <View style={styles.reviewAnswerRow}>
                <Text style={styles.reviewAnswerLabel}>RESPOSTA CORRETA</Text>
                <Text style={styles.reviewCorrectAnswer}>{item.options[item.answer_index] || 'Resposta não disponível'}</Text>
              </View>
              <View style={styles.reviewExplanation}><Text style={styles.reviewExplanationLabel}>POR QUÊ?</Text><Text style={styles.reviewExplanationText}>{item.explanation || 'Esta questão não possui explicação cadastrada.'}</Text></View>
            </View>
          );
        })}
        <Text style={styles.reviewFootnote}>Seu histórico e seu caderno ficam salvos neste aparelho.</Text>
      </ScrollView>
    );
  };

  const renderResult = () => {
    const percentage = result ? Math.round((result.correctCount / result.total) * 100) : 0;
    const resultMessage = sessionMode === 'daily' ? 'Desafio do dia concluído.' : percentage === 100 ? 'Você fechou a trilha com precisão.' : percentage >= 50 ? 'Você já tem uma boa base para seguir.' : 'Volte a algumas respostas e tente outra vez.';
    return (
      <ScrollView contentContainerStyle={styles.resultScreen} showsVerticalScrollIndicator={false}>
        <View style={styles.resultHeader}>
          <Text style={styles.resultEyebrow}>RESUMO DA TRILHA</Text>
          <Text style={styles.resultCategory}>{selectedCategory?.title || 'Trilha de cidadania'}</Text>
        </View>
        <View style={styles.resultScoreLine}>
          <Text style={styles.resultScoreValue}>{String(result?.correctCount || 0).padStart(2, '0')}</Text>
          <Text style={styles.resultScoreSlash}>/ {result?.total ?? 0}</Text>
        </View>
        <Text style={styles.resultScoreLabel}>respostas certas</Text>
        <Text style={styles.resultTitle}>{resultMessage}</Text>
        <Text style={styles.resultSub}>{sessionMode === 'daily' ? `Você somou ${result?.earnedXp || 0} XP, incluindo o bônus diário. O desafio de hoje ficou registrado.` : `Você também somou ${result?.earnedXp || 0} pontos de experiência. O histórico da rodada está salvo no seu perfil.`}</Text>
        <View style={styles.resultProgressWrap}>
          <View style={styles.resultProgressHeader}><Text style={styles.resultProgressLabel}>APROVEITAMENTO</Text><Text style={styles.resultProgressText}>{percentage}%</Text></View>
          <View style={styles.resultProgressTrack}><View style={[styles.resultProgressFill, { width: `${percentage}%` }]} /></View>
        </View>
        <Pressable onPress={() => sessionMode === 'track' ? startQuiz(selectedCategory) : startPractice(result?.total || 10)} style={styles.primaryButton} accessibilityRole="button"><Text style={styles.primaryButtonText}>{sessionMode === 'track' ? 'Refazer esta trilha' : 'Nova sessão de prática'}</Text><Text style={styles.primaryButtonArrow}>→</Text></Pressable>
        <Pressable onPress={() => { setActiveTab('home'); setScreen('home'); }} style={styles.secondaryButton} accessibilityRole="button"><Text style={styles.secondaryButtonText}>Voltar ao início</Text></Pressable>
      </ScrollView>
    );
  };

  return (
    <ReadingScaleContext.Provider value={readingScale}>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />
        <View style={styles.appFrame}>
          {screen === 'quiz' ? renderQuiz() : screen === 'result' ? renderResult() : screen === 'review' ? renderReview() : (
            <>
              <View style={styles.mainContent}>{screen === 'home' ? renderHome() : screen === 'explore' ? renderExplore() : renderProfile()}</View>
              <View style={styles.tabBar}>
                <TabButton label="Início" selected={activeTab === 'home'} onPress={() => chooseTab('home')} />
                <TabButton label="Explorar" selected={activeTab === 'explore'} onPress={() => chooseTab('explore')} />
                <TabButton label="Perfil" selected={activeTab === 'profile'} onPress={() => chooseTab('profile')} />
              </View>
            </>
          )}
        </View>
      </SafeAreaView>
    </ReadingScaleContext.Provider>
  );
}

export default function App() {
  return (
    <SQLiteProvider databaseName="cidadania-em-jogo.db" onInit={initializeDatabase}>
      <QuizApp />
    </SQLiteProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#EEE8DB' },
  appFrame: { flex: 1, width: '100%', maxWidth: 480, alignSelf: 'center', backgroundColor: COLORS.background },
  loadingScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.background },
  loadingLabel: { marginTop: 14, color: COLORS.muted, fontSize: 14, fontWeight: '600' },
  mainContent: { flex: 1 },
  homeContent: { paddingHorizontal: 22, paddingBottom: 28 },
  scrollContent: { paddingHorizontal: 22, paddingBottom: 30 },
  brandBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 15 },
  brandLockup: { flexDirection: 'row', alignItems: 'center' },
  brandStamp: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary, borderRadius: 15, marginRight: 11 },
  brandStampText: { color: COLORS.white, fontSize: 13, fontWeight: '900', letterSpacing: 0.4 },
  brandOverline: { color: COLORS.muted, fontSize: 8, fontWeight: '800', letterSpacing: 1.1 },
  brandName: { color: COLORS.ink, fontSize: 15, fontWeight: '800', marginTop: 3 },
  headerXp: { flexDirection: 'row', alignItems: 'baseline', backgroundColor: '#E4EBE2', borderRadius: 20, paddingVertical: 9, paddingHorizontal: 12 },
  headerXpValue: { color: COLORS.ink, fontSize: 13, fontWeight: '900' },
  headerXpLabel: { color: COLORS.muted, fontSize: 9, fontWeight: '800', marginLeft: 4 },
  homeIntro: { paddingTop: 34, paddingBottom: 25, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  eyebrow: { color: COLORS.terracotta, fontSize: 9, fontWeight: '800', letterSpacing: 1, marginBottom: 11 },
  homeTitle: { color: COLORS.ink, fontSize: 34, lineHeight: 40, fontWeight: '700', fontFamily: 'serif', letterSpacing: -0.7 },
  homeDescription: { maxWidth: 330, color: COLORS.muted, fontSize: 14, lineHeight: 22, marginTop: 11 },
  featureCard: { padding: 20, marginTop: 21, backgroundColor: COLORS.primary, borderRadius: 20, borderWidth: 1, borderColor: '#3C6857', elevation: 2 },
  featureTopline: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.18)' },
  featureLabel: { color: '#E5ECE0', fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  featureNumber: { color: '#E5ECE0', fontSize: 10, fontWeight: '800' },
  featureMain: { flexDirection: 'row', alignItems: 'center', paddingTop: 17, paddingBottom: 17 },
  featureCopy: { flex: 1, paddingRight: 8 },
  featureTitle: { color: COLORS.white, fontSize: 23, lineHeight: 28, fontWeight: '700', fontFamily: 'serif' },
  featureDescription: { color: '#E5ECE0', fontSize: 12, lineHeight: 19, marginTop: 8 },
  featureOrdinal: { color: 'rgba(255,255,255,0.2)', fontSize: 46, lineHeight: 52, fontWeight: '800', fontFamily: 'serif' },
  featureFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 14, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.18)' },
  featureMeta: { color: '#E5ECE0', fontSize: 10, fontWeight: '700', flexShrink: 1 },
  featureAction: { backgroundColor: COLORS.accent, borderRadius: 18, paddingVertical: 10, paddingHorizontal: 13, marginLeft: 8 },
  featureActionText: { color: COLORS.ink, fontSize: 10, fontWeight: '900' },
  dailyCard: { marginTop: 12, padding: 16, backgroundColor: '#F3E5C3', borderRadius: 17, borderWidth: 1, borderColor: '#E6D8B9' },
  dailyCardDone: { backgroundColor: COLORS.paleBlue, borderColor: '#D5E1D2' },
  dailyCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dailyEyebrow: { color: COLORS.primary, fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  dailyBonus: { color: COLORS.ink, fontSize: 9, fontWeight: '900', backgroundColor: COLORS.accent, borderRadius: 10, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 4 },
  dailyTitle: { color: COLORS.ink, fontSize: 17, lineHeight: 22, fontWeight: '800', marginTop: 10 },
  dailyDescription: { color: COLORS.muted, fontSize: 11, lineHeight: 17, marginTop: 4 },
  dailyAction: { alignSelf: 'flex-start', marginTop: 11, paddingVertical: 9, paddingHorizontal: 13, backgroundColor: COLORS.primary, borderRadius: 18 },
  dailyActionText: { color: COLORS.white, fontSize: 9, fontWeight: '900' },
  progressBand: { marginTop: 21, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  progressBandHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 11 },
  progressBandLabel: { color: COLORS.muted, fontSize: 8, fontWeight: '900', letterSpacing: 1.2 },
  progressBandTitle: { color: COLORS.ink, fontSize: 14, fontWeight: '800', marginTop: 4 },
  progressBandMuted: { color: COLORS.muted, fontWeight: '600' },
  progressBandNext: { color: COLORS.muted, fontSize: 9, textAlign: 'right', maxWidth: 125 },
  progressTrack: { height: 7, backgroundColor: '#DED9CC', overflow: 'hidden', borderRadius: 4 },
  progressFill: { height: 7, backgroundColor: COLORS.accent, borderRadius: 4 },
  reviewShortcutHeading: { marginTop: 20, marginBottom: 8 },
  reviewShortcutRow: { flexDirection: 'row', gap: 9 },
  reviewShortcut: { flex: 1, minHeight: 72, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 9, backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.line, borderRadius: 14 },
  reviewShortcutMark: { width: 29, height: 29, alignItems: 'center', justifyContent: 'center', borderRadius: 8, marginRight: 8 },
  reviewShortcutMarkText: { fontSize: 14, fontWeight: '900' },
  reviewShortcutCopy: { flex: 1 },
  reviewShortcutTitle: { color: COLORS.ink, fontSize: 10, fontWeight: '800' },
  reviewShortcutMeta: { color: COLORS.muted, fontSize: 9, marginTop: 4 },
  reviewShortcutArrow: { color: COLORS.muted, fontSize: 13, marginLeft: 3 },
  sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 24, marginBottom: 10 },
  sectionEyebrow: { color: COLORS.terracotta, fontSize: 8, fontWeight: '900', letterSpacing: 1.1 },
  sectionTitle: { color: COLORS.ink, fontSize: 18, fontWeight: '800', marginTop: 5 },
  sectionCount: { color: COLORS.muted, fontSize: 10, fontWeight: '700' },
  trackList: { borderTopWidth: 1, borderTopColor: COLORS.line },
  trackRow: { minHeight: 84, flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 10, backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.line, borderRadius: 16, marginBottom: 9 },
  civicIllustration: { width: 72, height: 60, overflow: 'hidden', borderRadius: 13, marginRight: 12, position: 'relative', alignItems: 'center', justifyContent: 'center' },
  artSun: { position: 'absolute', width: 43, height: 43, borderRadius: 22, right: -13, top: -12 },
  artBuilding: { position: 'absolute', width: 49, alignItems: 'center', bottom: 8 },
  artRoof: { width: 0, height: 0, borderLeftWidth: 25, borderRightWidth: 25, borderBottomWidth: 11, borderLeftColor: 'transparent', borderRightColor: 'transparent' },
  artBeam: { width: 46, height: 4, marginTop: -1, borderRadius: 2 },
  artColumns: { width: 38, height: 16, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 2 },
  artColumn: { width: 5, height: 15, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 },
  artBase: { width: 48, height: 4, borderRadius: 2 },
  artDialogue: { position: 'absolute', width: 51, height: 42, left: 10, top: 9 },
  artBubbleLarge: { width: 36, height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  artBubbleDots: { flexDirection: 'row', gap: 3 },
  artBubbleDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: COLORS.white },
  artBubbleSmall: { position: 'absolute', width: 27, height: 21, right: 0, bottom: 0, justifyContent: 'center', paddingHorizontal: 5, gap: 3, borderWidth: 1, borderRadius: 7 },
  artBubbleLine: { width: 14, height: 2, borderRadius: 2 },
  artBubbleLineShort: { width: 9, height: 2, borderRadius: 2 },
  artBalance: { position: 'absolute', width: 50, height: 44, left: 11, top: 8, alignItems: 'center' },
  artBalanceBeam: { position: 'absolute', width: 42, height: 3, top: 7, borderRadius: 2 },
  artBalanceStem: { position: 'absolute', width: 3, height: 27, top: 8, borderRadius: 2 },
  artBalancePlate: { position: 'absolute', width: 17, height: 8, top: 17, borderWidth: 1.5, borderTopWidth: 0, borderBottomLeftRadius: 10, borderBottomRightRadius: 10 },
  artBalancePlateLeft: { left: 0 },
  artBalancePlateRight: { right: 0 },
  artBalanceFoot: { position: 'absolute', width: 28, height: 4, bottom: 2, borderRadius: 2 },
  artDocument: { width: 34, height: 43, position: 'absolute', alignItems: 'flex-start', justifyContent: 'center', gap: 4, paddingHorizontal: 6, paddingTop: 8, borderWidth: 1, borderRadius: 5 },
  artDocumentSeal: { position: 'absolute', width: 7, height: 7, top: 5, right: 5, borderRadius: 4 },
  artDocumentLine: { width: 21, height: 2, borderRadius: 2 },
  artDocumentLineShort: { width: 14 },
  illustrationIndex: { position: 'absolute', right: 4, bottom: 4, paddingHorizontal: 4, paddingVertical: 2, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.88)' },
  illustrationIndexText: { color: COLORS.ink, fontSize: 7, fontWeight: '900' },
  trackCopy: { flex: 1, paddingRight: 6 },
  trackTitle: { color: COLORS.ink, fontSize: 14, fontWeight: '800' },
  trackSubtitle: { color: COLORS.muted, fontSize: 11, marginTop: 3 },
  trackMeta: { color: COLORS.muted, fontSize: 10, marginTop: 4 },
  trackArrow: { fontSize: 19, fontWeight: '500', paddingLeft: 8 },
  noteBlock: { padding: 17, marginTop: 20, backgroundColor: COLORS.paleBlue, borderRadius: 15, borderLeftWidth: 3, borderLeftColor: COLORS.terracotta },
  noteLabel: { color: COLORS.terracotta, fontSize: 8, fontWeight: '900', letterSpacing: 1.1 },
  noteText: { color: COLORS.ink, fontSize: 12, lineHeight: 18, marginTop: 6 },
  noteSource: { color: COLORS.muted, fontSize: 8, textAlign: 'right', marginTop: 7 },
  tabBar: { height: 66, flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.white, borderTopWidth: 1, borderTopColor: COLORS.line, paddingHorizontal: 12 },
  tabButton: { flex: 1, height: 62, alignItems: 'center', justifyContent: 'center' },
  tabIndicator: { width: 18, height: 2, backgroundColor: 'transparent', marginBottom: 7 },
  tabIndicatorSelected: { backgroundColor: COLORS.terracotta },
  tabLabel: { color: COLORS.muted, fontSize: 10, fontWeight: '700' },
  tabLabelSelected: { color: COLORS.ink, fontWeight: '900' },
  pageHeader: { paddingTop: 31, paddingBottom: 22 },
  pageTitle: { color: COLORS.ink, fontSize: 31, lineHeight: 37, fontWeight: '700', fontFamily: 'serif', letterSpacing: -0.6 },
  pageSub: { color: COLORS.muted, fontSize: 13, lineHeight: 21, marginTop: 8 },
  practicePanel: { padding: 17, marginBottom: 16, backgroundColor: COLORS.paleBlue, borderRadius: 17, borderWidth: 1, borderColor: '#D6E0D3' },
  practiceEyebrow: { color: COLORS.primary, fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  practiceTitle: { color: COLORS.ink, fontSize: 18, fontWeight: '800', marginTop: 7 },
  practiceDescription: { color: COLORS.muted, fontSize: 11, lineHeight: 17, marginTop: 5 },
  practiceActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  practiceButton: { flex: 1, minHeight: 49, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.line, borderRadius: 12 },
  practiceButtonSelected: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  practiceButtonValue: { color: COLORS.primary, fontSize: 15, fontWeight: '900' },
  practiceButtonValueSelected: { color: COLORS.white },
  practiceButtonLabel: { color: COLORS.muted, fontSize: 8, fontWeight: '700', marginTop: 1 },
  practiceButtonLabelSelected: { color: '#E5ECE0' },
  profileSummary: { minHeight: 126, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 19, backgroundColor: COLORS.primary, borderRadius: 18 },
  profileSummaryLabel: { color: '#E5ECE0', fontSize: 8, fontWeight: '900', letterSpacing: 1.1 },
  profileTotalXp: { color: COLORS.white, fontSize: 40, lineHeight: 45, fontWeight: '800', marginTop: 5 },
  profileXpSuffix: { fontSize: 14, fontWeight: '700' },
  profileLevelTag: { minWidth: 62, alignItems: 'center', paddingVertical: 8, paddingHorizontal: 10, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 6 },
  profileLevelTagLabel: { color: '#E5ECE0', fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  profileLevelTagValue: { color: COLORS.white, fontSize: 18, fontWeight: '900', marginTop: 3 },
  streakPanel: { flexDirection: 'row', alignItems: 'center', marginTop: 10, padding: 13, backgroundColor: '#E7EEE2', borderRadius: 15 },
  streakMark: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary, borderRadius: 11, marginRight: 11 },
  streakMarkText: { color: COLORS.accent, fontSize: 14, fontWeight: '900' },
  streakCopy: { flex: 1 },
  streakTitle: { color: COLORS.ink, fontSize: 11, fontWeight: '900' },
  streakDescription: { color: COLORS.muted, fontSize: 9, lineHeight: 14, marginTop: 3 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 13 },
  statCard: { flex: 1, minHeight: 76, justifyContent: 'center', backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.line, paddingVertical: 10, paddingHorizontal: 11, marginRight: 7 },
  statValue: { color: COLORS.ink, fontSize: 20, fontWeight: '900' },
  statLabel: { color: COLORS.muted, fontSize: 8, lineHeight: 12, fontWeight: '700', marginTop: 3 },
  profileTools: { gap: 8, marginTop: 1, marginBottom: 5 },
  profileToolButton: { minHeight: 66, justifyContent: 'center', paddingHorizontal: 13, paddingVertical: 10, backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.line, borderRadius: 8 },
  profileToolTitle: { color: COLORS.ink, fontSize: 12, fontWeight: '800' },
  profileToolMeta: { color: COLORS.muted, fontSize: 10, marginTop: 4 },
  profileToolArrow: { position: 'absolute', right: 13, top: 21, color: COLORS.primary, fontSize: 17 },
  accessibilityPanel: { marginTop: 11, padding: 14, backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.line, borderRadius: 8 },
  accessibilityTitle: { color: COLORS.ink, fontSize: 13, fontWeight: '800', marginTop: 7 },
  accessibilityDescription: { color: COLORS.muted, fontSize: 10, lineHeight: 15, marginTop: 4 },
  accessibilityControls: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 11 },
  accessibilityPreview: { marginTop: 12, padding: 12, backgroundColor: COLORS.background, borderRadius: 12 },
  accessibilityPreviewText: { color: COLORS.ink, fontSize: 12, lineHeight: 18 },
  textScaleButton: { minWidth: 42, height: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary, borderRadius: 6 },
  textScaleButtonDisabled: { backgroundColor: '#E7E3DB' },
  textScaleButtonText: { color: COLORS.white, fontSize: 12, fontWeight: '900' },
  textScaleButtonTextDisabled: { color: COLORS.muted },
  textScaleValue: { minWidth: 45, color: COLORS.ink, fontSize: 11, fontWeight: '900', textAlign: 'center' },
  profileSectionHeader: { marginTop: 13, marginBottom: 10 },
  profileSectionHint: { color: COLORS.muted, fontSize: 10, marginTop: 5 },
  activityList: { borderTopWidth: 1, borderTopColor: COLORS.line },
  activityRow: { minHeight: 57, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: COLORS.line },
  activityMarker: { width: 3, height: 27, marginRight: 11 },
  activityCopy: { flex: 1 },
  activityTitle: { color: COLORS.ink, fontSize: 12, fontWeight: '800' },
  activityMeta: { color: COLORS.muted, fontSize: 9, marginTop: 3 },
  activityScore: { color: COLORS.ink, fontSize: 11, fontWeight: '800' },
  activityScoreMuted: { color: COLORS.muted, fontSize: 9, fontWeight: '500' },
  quizScreen: { flex: 1, backgroundColor: COLORS.background },
  quizTop: { minHeight: 72, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22 },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.paleBlue, borderRadius: 8 },
  backIcon: { color: COLORS.ink, fontSize: 20, fontWeight: '500' },
  quizTopCopy: { flex: 1, alignItems: 'center' },
  quizTopLabel: { color: COLORS.muted, fontSize: 8, fontWeight: '900', letterSpacing: 1.1 },
  quizTopic: { color: COLORS.ink, fontSize: 12, fontWeight: '800', marginTop: 2 },
  quizCount: { minWidth: 50, color: COLORS.ink, fontSize: 13, fontWeight: '900', textAlign: 'right' },
  quizCountMuted: { color: COLORS.muted, fontWeight: '600' },
  quizProgressTrack: { height: 3, backgroundColor: '#DED9CC', marginHorizontal: 22, overflow: 'hidden' },
  quizProgressFill: { height: 3, backgroundColor: COLORS.terracotta },
  quizEmptyState: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: COLORS.background },
  emptyStateEyebrow: { color: COLORS.terracotta, fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  emptyStateTitle: { color: COLORS.ink, fontSize: 24, lineHeight: 31, fontWeight: '800', marginTop: 9, marginBottom: 18 },
  quizContent: { paddingHorizontal: 22, paddingTop: 28, paddingBottom: 24 },
  questionOverline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  questionOverlineCopy: { flexDirection: 'row', alignItems: 'center' },
  saveQuestionButton: { borderWidth: 1, borderColor: COLORS.line, borderRadius: 15, paddingHorizontal: 11, paddingVertical: 6, backgroundColor: COLORS.white },
  saveQuestionButtonActive: { borderColor: COLORS.accent, backgroundColor: '#F3E5C3' },
  saveQuestionText: { color: COLORS.muted, fontSize: 9, fontWeight: '900' },
  saveQuestionTextActive: { color: COLORS.primary },
  missionPillText: { color: COLORS.terracotta, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  questionTotal: { color: COLORS.muted, fontSize: 9, fontWeight: '800', letterSpacing: 1, marginLeft: 9 },
  questionTitle: { color: COLORS.ink, fontSize: 25, lineHeight: 34, fontWeight: '700', fontFamily: 'serif', letterSpacing: -0.3 },
  questionHint: { color: COLORS.muted, fontSize: 12, lineHeight: 18, marginTop: 9, marginBottom: 21 },
  optionsList: { marginTop: 2 },
  optionCard: { minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 12, backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.line, borderRadius: 15, marginBottom: 9 },
  optionSelected: { borderColor: COLORS.primary, backgroundColor: COLORS.paleBlue },
  optionCorrect: { borderColor: COLORS.success, backgroundColor: COLORS.successBg },
  optionWrong: { borderColor: COLORS.error, backgroundColor: COLORS.errorBg },
  optionLetter: { width: 31, height: 31, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.paleBlue, borderRadius: 11, marginRight: 11 },
  optionLetterSelected: { backgroundColor: COLORS.primary },
  optionLetterCorrect: { backgroundColor: COLORS.success },
  optionLetterWrong: { backgroundColor: COLORS.error },
  optionLetterText: { color: COLORS.muted, fontSize: 10, fontWeight: '900' },
  optionLetterTextActive: { color: COLORS.white },
  optionText: { flex: 1, color: COLORS.ink, fontSize: 13, fontWeight: '500', lineHeight: 19 },
  feedbackCard: { padding: 15, marginTop: 11, borderLeftWidth: 3, borderRadius: 14 },
  feedbackCorrect: { backgroundColor: COLORS.successBg, borderLeftColor: COLORS.success },
  feedbackIncorrect: { backgroundColor: COLORS.errorBg, borderLeftColor: COLORS.error },
  feedbackTitle: { color: COLORS.ink, fontSize: 13, fontWeight: '900', marginBottom: 5 },
  feedbackBody: { color: COLORS.muted, fontSize: 12, lineHeight: 18 },
  quizFooter: { paddingHorizontal: 22, paddingTop: 12, paddingBottom: 17, backgroundColor: COLORS.background, borderTopWidth: 1, borderTopColor: COLORS.line },
  primaryButton: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, backgroundColor: COLORS.primary, borderRadius: 18 },
  primaryButtonDisabled: { backgroundColor: '#B4BBB0' },
  primaryButtonText: { color: COLORS.white, fontSize: 12, fontWeight: '900' },
  primaryButtonDisabledText: { color: COLORS.ink },
  primaryButtonArrow: { color: COLORS.white, fontSize: 17, fontWeight: '700', marginLeft: 10 },
  reviewScreen: { flexGrow: 1, paddingHorizontal: 22, paddingTop: 23, paddingBottom: 30 },
  reviewHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 13 },
  reviewHeaderCopy: { flex: 1, marginLeft: 13 },
  emptyReviewCard: { alignItems: 'flex-start', marginTop: 24, padding: 19, backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.line, borderRadius: 17 },
  emptyReviewMark: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.paleBlue, borderRadius: 10, marginBottom: 14 },
  emptyReviewMarkText: { color: COLORS.primary, fontSize: 15, fontWeight: '900' },
  emptyReviewTitle: { color: COLORS.ink, fontSize: 18, fontWeight: '800' },
  emptyReviewBody: { color: COLORS.muted, fontSize: 12, lineHeight: 19, marginTop: 7, marginBottom: 9 },
  reviewCard: { marginTop: 13, padding: 16, backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.line, borderRadius: 17 },
  reviewCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 11 },
  reviewCategory: { fontSize: 9, fontWeight: '900', letterSpacing: 0.6 },
  reviewSaveButton: { borderRadius: 13, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: COLORS.paleBlue },
  reviewSaveText: { color: COLORS.muted, fontSize: 9, fontWeight: '900' },
  reviewSaveTextActive: { color: COLORS.primary },
  reviewQuestion: { color: COLORS.ink, fontSize: 15, lineHeight: 22, fontWeight: '800', marginBottom: 13 },
  reviewAnswerRow: { marginTop: 9 },
  reviewAnswerLabel: { color: COLORS.muted, fontSize: 8, fontWeight: '900', letterSpacing: 0.8, marginBottom: 4 },
  reviewWrongAnswer: { color: COLORS.error, fontSize: 11, lineHeight: 17, fontWeight: '600' },
  reviewCorrectAnswer: { color: COLORS.success, fontSize: 11, lineHeight: 17, fontWeight: '700' },
  reviewExplanation: { marginTop: 13, padding: 11, backgroundColor: COLORS.background, borderRadius: 6 },
  reviewExplanationLabel: { color: COLORS.primary, fontSize: 8, fontWeight: '900', letterSpacing: 0.8, marginBottom: 5 },
  reviewExplanationText: { color: COLORS.ink, fontSize: 11, lineHeight: 17 },
  reviewFootnote: { color: COLORS.muted, fontSize: 10, lineHeight: 15, textAlign: 'center', marginTop: 18 },
  resultScreen: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 35, paddingBottom: 28, justifyContent: 'center' },
  resultHeader: { borderBottomWidth: 1, borderBottomColor: COLORS.line, paddingBottom: 17 },
  resultEyebrow: { color: COLORS.terracotta, fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  resultCategory: { color: COLORS.ink, fontSize: 14, fontWeight: '800', marginTop: 5 },
  resultScoreLine: { flexDirection: 'row', alignItems: 'baseline', marginTop: 24 },
  resultScoreValue: { color: COLORS.primary, fontSize: 74, lineHeight: 79, fontWeight: '700', fontFamily: 'serif', letterSpacing: -2 },
  resultScoreSlash: { color: COLORS.muted, fontSize: 20, fontWeight: '600', marginLeft: 6 },
  resultScoreLabel: { color: COLORS.muted, fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },
  resultTitle: { maxWidth: 340, color: COLORS.ink, fontSize: 25, lineHeight: 32, fontWeight: '700', fontFamily: 'serif', marginTop: 20 },
  resultSub: { maxWidth: 340, color: COLORS.muted, fontSize: 13, lineHeight: 20, marginTop: 9 },
  resultProgressWrap: { marginTop: 25, marginBottom: 23, padding: 15, backgroundColor: COLORS.paleBlue, borderRadius: 15 },
  resultProgressHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 },
  resultProgressLabel: { color: COLORS.muted, fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  resultProgressText: { color: COLORS.ink, fontSize: 11, fontWeight: '900' },
  resultProgressTrack: { height: 5, backgroundColor: '#D7D1C3', overflow: 'hidden' },
  resultProgressFill: { height: 5, backgroundColor: COLORS.terracotta },
  secondaryButton: { minHeight: 46, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  secondaryButtonText: { color: COLORS.primary, fontSize: 12, fontWeight: '900' },
});
