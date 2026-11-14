import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { useAppLock } from '@/lib/app-lock';

export function LockSettingsCard() {
  const { hasPin, openSetup, removePin, lock } = useAppLock();

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Быстрая блокировка</CardTitle>
        <Badge tone={hasPin ? 'success' : 'neutral'}>
          {hasPin ? 'Код установлен' : 'Код не установлен'}
        </Badge>
      </div>
      <CardDescription>
        Экран блокировки скрывает приложение от случайных глаз. Код из 6 цифр хранится только на
        этом устройстве и не заменяет пароль и 2FA.
      </CardDescription>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant={hasPin ? 'secondary' : 'primary'} onClick={openSetup}>
          {hasPin ? 'Изменить код' : 'Установить код'}
        </Button>
        {hasPin ? (
          <>
            <Button variant="secondary" onClick={lock}>
              Заблокировать сейчас
            </Button>
            <Button
              variant="ghost"
              className="text-red-700"
              onClick={() => {
                if (
                  window.confirm(
                    'Удалить код блокировки? Приложение больше не будет блокироваться этим кодом.',
                  )
                ) {
                  removePin();
                }
              }}
            >
              Удалить код
            </Button>
          </>
        ) : null}
      </div>
    </Card>
  );
}
