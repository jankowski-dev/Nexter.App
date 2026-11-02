import { Card, CardDescription, CardTitle } from '@/components/ui/card';

export function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Раздел будет реализован на следующей фазе по спецификации.
        </p>
      </div>

      <Card>
        <CardTitle>Phase 1 — Foundation</CardTitle>
        <CardDescription>
          Сейчас собран каркас приложения: API, база данных, фронтенд, healthcheck и CI.
          Функциональные экраны появятся в Phase 5.
        </CardDescription>
      </Card>
    </div>
  );
}
