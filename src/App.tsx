import { useMemo, useState } from 'react'

// Types for TheMealDB
type MealSummary = {
  idMeal: string;
  strMeal: string;
  strMealThumb: string;
}

type MealDetails = MealSummary & {
  strCategory: string | null;
  strArea: string | null;
  strTags: string | null;
  strInstructions: string | null;
  // strIngredient1..20 + strMeasure1..20 exist but are dynamic keys
  [key: string]: any;
}

const API = {
  filterByIngredient: async (ingredient: string): Promise<MealSummary[]> => {
    const url = `https://www.themealdb.com/api/json/v1/1/filter.php?i=${encodeURIComponent(
      ingredient
    )}`
    const res = await fetch(url)
    if (!res.ok) throw new Error('Network error fetching meals')
    const data = await res.json()
    return (data?.meals as MealSummary[] | null) ?? []
  },
  detailsById: async (id: string): Promise<MealDetails | null> => {
    const url = `https://www.themealdb.com/api/json/v1/1/lookup.php?i=${id}`
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()
    return (data?.meals?.[0] as MealDetails | undefined) ?? null
  },
}

// Mood to categories/tags mapping (heuristic)
const MOOD_MAP: Record<string, { categories?: string[]; tagsContains?: string[] }> = {
  Comforting: { categories: ['Beef', 'Pasta', 'Pork', 'Chicken'] },
  Healthy: { categories: ['Vegetarian', 'Vegan', 'Salad'], tagsContains: ['Low Fat', 'Healthy'] },
  Adventurous: { categories: ['Seafood', 'Lamb', 'Goat'], tagsContains: ['Spicy'] },
  Quick: { tagsContains: ['Quick', 'Easy'] },
}

const DIETS = ['None', 'Vegetarian', 'Vegan', 'Gluten-Free'] as const

type Diet = (typeof DIETS)[number]

type TimeChoice = 'Any' | 'Under 15' | 'Under 30' | 'Under 45' | '60+'

function estimateMinutes(m: MealDetails): number {
  const instr = (m.strInstructions ?? '').trim()
  const words = instr.split(/\s+/).filter(Boolean).length
  const ingredientsCount = getIngredients(m).length
  // rough heuristic: 0.25 min per word + 2 min per ingredient, clamped
  const est = Math.round(words * 0.25 + ingredientsCount * 2)
  return Math.max(5, Math.min(est, 180))
}

function getIngredients(m: MealDetails): { ingredient: string; measure: string }[] {
  const items: { ingredient: string; measure: string }[] = []
  for (let i = 1; i <= 20; i++) {
    const ing = (m as any)[`strIngredient${i}`]
    const meas = (m as any)[`strMeasure${i}`]
    if (ing && String(ing).trim()) {
      items.push({ ingredient: String(ing).trim(), measure: String(meas ?? '').trim() })
    }
  }
  return items
}

function matchesDiet(m: MealDetails, diet: Diet): boolean {
  if (diet === 'None') return true
  const tags = (m.strTags ?? '').toLowerCase()
  const category = (m.strCategory ?? '').toLowerCase()
  const ings = getIngredients(m).map((i) => i.ingredient.toLowerCase())
  if (diet === 'Vegetarian') return tags.includes('vegetarian') || category === 'vegetarian'
  if (diet === 'Vegan') return tags.includes('vegan') || category === 'vegan'
  if (diet === 'Gluten-Free') {
    const gluteny = ['flour', 'bread', 'pasta', 'noodles', 'wheat', 'barley', 'bulgur', 'semolina']
    return !ings.some((i) => gluteny.some((g) => i.includes(g)))
  }
  return true
}

function matchesMood(m: MealDetails, mood: keyof typeof MOOD_MAP | 'Any'): boolean {
  if (mood === 'Any') return true
  const conf = MOOD_MAP[mood]
  const category = m.strCategory ?? ''
  const tags = (m.strTags ?? '').split(',').map((t) => t.trim())
  const catOk = !conf.categories || conf.categories.includes(category)
  const tagOk = !conf.tagsContains || conf.tagsContains.some((t) => tags.some((x) => x.includes(t)))
  return catOk || tagOk
}

function matchesTime(m: MealDetails, time: TimeChoice): boolean {
  if (time === 'Any') return true
  const mins = estimateMinutes(m)
  if (time === 'Under 15') return mins <= 15
  if (time === 'Under 30') return mins <= 30
  if (time === 'Under 45') return mins <= 45
  return mins >= 60
}

function excludeIngredients(m: MealDetails, excludes: string[]): boolean {
  if (!excludes.length) return true
  const ings = getIngredients(m).map((i) => i.ingredient.toLowerCase())
  return !excludes.some((ex) => ings.some((i) => i.includes(ex)))
}

function App() {
  const [ingredientsInput, setIngredientsInput] = useState('')
  const [excludeInput, setExcludeInput] = useState('')
  const [time, setTime] = useState<TimeChoice>('Any')
  const [mood, setMood] = useState<'Any' | keyof typeof MOOD_MAP>('Any')
  const [diet, setDiet] = useState<Diet>('None')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [meals, setMeals] = useState<MealDetails[]>([])
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const parsedIngredients = useMemo(
    () => ingredientsInput.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    [ingredientsInput]
  )
  const parsedExcludes = useMemo(
    () => excludeInput.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    [excludeInput]
  )

  async function onSearch(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setMeals([])
    setExpanded({})

    try {
      if (parsedIngredients.length === 0) {
        setError('Enter at least one ingredient.')
        setLoading(false)
        return
      }

      // Query each ingredient separately, then intersect IDs
      const lists = await Promise.all(parsedIngredients.map((ing) => API.filterByIngredient(ing)))
      const idSets = lists.map((list) => new Set(list.map((m) => m.idMeal)))
      // Intersect all sets
      let intersection: Set<string> | null = null
      for (const s of idSets) {
        if (!intersection) intersection = new Set(s)
        else intersection = new Set([...intersection].filter((id) => s.has(id)))
      }
      const ids = [...(intersection ?? new Set<string>())]
      if (ids.length === 0) {
        setMeals([])
        setLoading(false)
        return
      }

      // Fetch details for up to 24 meals in parallel
      const selected = ids.slice(0, 24)
      const details = (await Promise.all(selected.map((id) => API.detailsById(id)))).filter(
        (m): m is MealDetails => !!m
      )

      // Apply additional filters
      const filtered = details.filter(
        (m) => matchesTime(m, time) && matchesMood(m, mood) && matchesDiet(m, diet) && excludeIngredients(m, parsedExcludes)
      )

      setMeals(filtered)
    } catch (err: any) {
      setError(err?.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b border-slate-200">
        <div className="mx-auto max-w-6xl px-4 py-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Recipe Suggestions</h1>
            <p className="text-sm text-slate-600">Find meals by ingredients, mood, time, and diet.</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <form onSubmit={onSearch} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Ingredients</span>
            <input
              value={ingredientsInput}
              onChange={(e) => setIngredientsInput(e.target.value)}
              placeholder="e.g. chicken, rice"
              className="rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-xs text-slate-500">Comma-separated. Matches meals that include all.</span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Exclude Ingredients</span>
            <input
              value={excludeInput}
              onChange={(e) => setExcludeInput(e.target.value)}
              placeholder="e.g. nuts, dairy"
              className="rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-xs text-slate-500">We’ll filter these out from results.</span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Mood</span>
            <select
              value={mood}
              onChange={(e) => setMood(e.target.value as any)}
              className="rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option>Any</option>
              {Object.keys(MOOD_MAP).map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Time to cook</span>
            <select
              value={time}
              onChange={(e) => setTime(e.target.value as TimeChoice)}
              className="rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {['Any', 'Under 15', 'Under 30', 'Under 45', '60+'].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-1">
            <span className="text-sm font-medium">Diet</span>
            <select
              value={diet}
              onChange={(e) => setDiet(e.target.value as Diet)}
              className="rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {DIETS.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </label>

          <div className="flex items-end">
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
              disabled={loading}
            >
              {loading ? 'Searching…' : 'Search'}
            </button>
          </div>
        </form>

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">{error}</div>
        )}

        {!loading && meals.length === 0 && !error && (
          <p className="mt-6 text-center text-slate-600">No results yet. Try searching by ingredients.</p>
        )}

        <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {meals.map((m) => {
            const mins = estimateMinutes(m)
            const isOpen = !!expanded[m.idMeal]
            const ingredients = getIngredients(m)
            return (
              <article key={m.idMeal} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <img src={m.strMealThumb} alt={m.strMeal} className="h-40 w-full object-cover" />
                <div className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-lg font-semibold">{m.strMeal}</h3>
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700">~{mins} min</span>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-slate-600">
                    {m.strCategory && <span className="rounded bg-slate-100 px-2 py-1">{m.strCategory}</span>}
                    {m.strArea && <span className="rounded bg-slate-100 px-2 py-1">{m.strArea}</span>}
                    {(m.strTags ?? '')
                      .split(',')
                      .filter(Boolean)
                      .slice(0, 3)
                      .map((t) => (
                        <span key={t} className="rounded bg-slate-100 px-2 py-1">
                          {t}
                        </span>
                      ))}
                  </div>

                  <button
                    onClick={() => setExpanded((s) => ({ ...s, [m.idMeal]: !s[m.idMeal] }))}
                    className="text-sm text-blue-600 hover:underline"
                  >
                    {isOpen ? 'Hide details' : 'Show details'}
                  </button>

                  {isOpen && (
                    <div className="space-y-3">
                      <div>
                        <h4 className="font-medium">Ingredients</h4>
                        <ul className="mt-1 list-disc pl-5 text-sm text-slate-700">
                          {ingredients.map((it, idx) => (
                            <li key={idx}>
                              {it.ingredient} {it.measure && <span className="text-slate-500">— {it.measure}</span>}
                            </li>
                          ))}
                        </ul>
                      </div>
                      {m.strInstructions && (
                        <div>
                          <h4 className="font-medium">Instructions</h4>
                          <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-700">
                            {m.strInstructions}
                          </p>
                        </div>
                      )}
                      <a
                        className="inline-block text-sm text-blue-600 hover:underline"
                        href={`https://www.themealdb.com/meal.php?c=${m.idMeal}`}
                        target="_blank"
                      >
                        Open on TheMealDB →
                      </a>
                    </div>
                  )}
                </div>
              </article>
            )
          })}
        </section>
      </main>
    </div>
  )
}

export default App
