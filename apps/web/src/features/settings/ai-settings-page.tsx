import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import {
  fetchAiSettings,
  fetchSettings,
  testAiConnection,
  updateAiSettings,
  updateSettings,
} from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatDateTime } from '@/lib/format';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { AUDIO_MAX_MB_MAX, AUDIO_MAX_MB_MIN, type AiTestResponse } from '@nexter/contracts';

const models = [
  { value: 'deepseek-flash', label: 'DeepSeek Flash — быстрая' },
  { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro — глубже' },
  { value: 'deepseek-chat', label: 'DeepSeek Chat (legacy)' },
  { value: 'deepseek-reasoner', label: 'DeepSeek Reasoner (legacy)' },
];

export function AiSettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['ai-settings'], queryFn: fetchAiSettings });
  const generalSettings = useQuery({ queryKey: ['settings'], queryFn: fetchSettings });
  const [enabled, setEnabled] = useState(false);
  const [model, setModel] = useState('deepseek-flash');
  const [reasoning, setReasoning] = useState<'fast' | 'reasoning'>('fast');
  const [temperature, setTemperature] = useState('0.30');
  const [maxTokens, setMaxTokens] = useState('2000');
  const [fallbackToRaw, setFallbackToRaw] = useState(true);
  const [apiKey, setApiKey] = useState('');
  const [audioMaxMb, setAudioMaxMb] = useState('');
  const [audioDirty, setAudioDirty] = useState(false);
  const [test, setTest] = useState<AiTestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!settings.data) return;
    setEnabled(settings.data.enabled);
    setModel(settings.data.model);
    setReasoning(settings.data.reasoning);
    setTemperature(String(settings.data.temperature));
    setMaxTokens(String(settings.data.maxTokens));
    setFallbackToRaw(settings.data.fallbackToRaw);
    setDirty(false);
  }, [settings.data]);

  useEffect(() => {
    if (!generalSettings.data) return;
    setAudioMaxMb(String(generalSettings.data.audioMaxMb));
    setAudioDirty(false);
  }, [generalSettings.data]);

  const save = useMutation({
    mutationFn: () =>
      updateAiSettings({
        enabled,
        model,
        reasoning,
        temperature: Number(temperature),
        maxTokens: Number(maxTokens),
        fallbackToRaw,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['ai-settings'], data);
      setApiKey('');
      setError(null);
      setDirty(false);
      setNotice(
        data.enabled ? 'Настройки ИИ сохранены.' : 'Настройки сохранены, но модуль выключен.',
      );
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось сохранить настройки ИИ')),
  });

  const testMutation = useMutation({
    mutationFn: testAiConnection,
    onSuccess: (data) => {
      setTest(data);
      setError(null);
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось проверить подключение')),
  });

  const removeKey = useMutation({
    mutationFn: () => updateAiSettings({ clearApiKey: true }),
    onSuccess: (data) => {
      queryClient.setQueryData(['ai-settings'], data);
      setTest(null);
      setDirty(false);
      setNotice('API-ключ удалён.');
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось удалить ключ')),
  });

  const saveAudioLimit = useMutation({
    mutationFn: (value: number) => updateSettings({ audioMaxMb: value }),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings'], data);
      setAudioDirty(false);
      setError(null);
      setNotice('Лимит аудио сохранён.');
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось сохранить лимит аудио')),
  });

  function saveAudio() {
    const value = Number(audioMaxMb);
    if (!Number.isInteger(value) || value < AUDIO_MAX_MB_MIN || value > AUDIO_MAX_MB_MAX) {
      setError(
        `Лимит аудио должен быть целым числом от ${AUDIO_MAX_MB_MIN} до ${AUDIO_MAX_MB_MAX} МБ.`,
      );
      return;
    }
    saveAudioLimit.mutate(value);
  }

  function touch() {
    setDirty(true);
    setNotice(null);
    setTest(null);
    setError(null);
  }

  if (settings.isPending) {
    return (
      <div className="space-y-6">
        <PageHeader title="ИИ" />
        <LoadingRows rows={4} />
      </div>
    );
  }

  if (settings.isError || !settings.data) {
    return (
      <div className="space-y-6">
        <PageHeader title="ИИ" />
        <ErrorState
          message={toRussianError(settings.error, 'Не удалось загрузить настройки ИИ')}
          onRetry={() => void settings.refetch()}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="ИИ"
        subtitle="Модуль для будущих функций: аудиозаметки, структурирование, анализ. Ключ хранится зашифрованным."
      />

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {notice}
        </div>
      ) : null}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Подключение</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Badge tone={settings.data.enabled ? 'success' : 'neutral'}>
              {settings.data.enabled ? 'Модуль включён' : 'Модуль выключен'}
            </Badge>
            <Badge tone={settings.data.hasApiKey ? 'success' : 'neutral'}>
              {settings.data.hasApiKey ? 'Ключ сохранён' : 'Ключ не задан'}
            </Badge>
          </div>
        </div>
        <CardDescription>
          Провайдер DeepSeek. Ключ шифруется на сервере и никогда не возвращается в интерфейс.
        </CardDescription>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block text-sm text-zinc-600">
            API-ключ
            <Input
              className="mt-1"
              type="password"
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value);
                touch();
              }}
              placeholder={
                settings.data.hasApiKey ? 'Ключ сохранён — введите новый для замены' : 'sk-...'
              }
              autoComplete="off"
            />
          </label>
          <label className="mt-7 flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => {
                setEnabled(event.target.checked);
                touch();
              }}
              className="h-4 w-4 rounded border-zinc-300 bg-white"
            />
            Включить ИИ-модуль
          </label>
          <label className="block text-sm text-zinc-600">
            Модель
            <Select
              className="mt-1"
              value={model}
              onChange={(event) => {
                setModel(event.target.value);
                touch();
              }}
              aria-label="Модель DeepSeek"
            >
              {models.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="block text-sm text-zinc-600">
            Режим
            <Select
              className="mt-1"
              value={reasoning}
              onChange={(event) => {
                setReasoning(event.target.value as 'fast' | 'reasoning');
                touch();
              }}
              aria-label="Режим мышления"
            >
              <option value="fast">Быстрый</option>
              <option value="reasoning">Рассуждение</option>
            </Select>
            <span className="mt-1 block text-xs text-zinc-500">
              Режим рассуждения использует DeepSeek V4 Pro.
            </span>
          </label>
          <label className="block text-sm text-zinc-600">
            Temperature
            <Input
              className="mt-1"
              type="number"
              min={0}
              max={2}
              step={0.05}
              value={temperature}
              onChange={(event) => {
                setTemperature(event.target.value);
                touch();
              }}
            />
          </label>
          <label className="block text-sm text-zinc-600">
            Максимум токенов ответа
            <Input
              className="mt-1"
              type="number"
              min={256}
              max={8192}
              step={128}
              value={maxTokens}
              onChange={(event) => {
                setMaxTokens(event.target.value);
                touch();
              }}
            />
          </label>
        </div>

        <label className="mt-4 flex items-start gap-2 text-sm text-zinc-700">
          <input
            type="checkbox"
            checked={fallbackToRaw}
            onChange={(event) => {
              setFallbackToRaw(event.target.checked);
              touch();
            }}
            className="mt-0.5 h-4 w-4 rounded border-zinc-300 bg-white"
          />
          <span>
            Если ИИ недоступен — сохранить сырой транскрипт
            <span className="mt-0.5 block text-xs text-zinc-500">
              Иначе аудиозаметка не создастся, а ошибка останется в журнале.
            </span>
          </span>
        </label>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? 'Сохраняю…' : 'Сохранить'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => testMutation.mutate()}
            disabled={
              testMutation.isPending || !settings.data.hasApiKey || !settings.data.enabled || dirty
            }
            title={
              dirty
                ? 'Сначала сохраните изменения'
                : !settings.data.enabled
                  ? 'Включите модуль и сохраните'
                  : !settings.data.hasApiKey
                    ? 'Сначала сохраните API-ключ'
                    : undefined
            }
          >
            {testMutation.isPending ? 'Проверяю…' : 'Проверить подключение'}
          </Button>
          {settings.data.hasApiKey ? (
            <Button
              variant="ghost"
              className="text-red-700"
              onClick={() => removeKey.mutate()}
              disabled={removeKey.isPending}
            >
              Удалить ключ
            </Button>
          ) : null}
          <span className="text-xs text-zinc-500">
            {dirty
              ? 'Есть несохранённые изменения'
              : `Обновлено ${formatDateTime(settings.data.updatedAt)}`}
          </span>
        </div>

        {test ? (
          <div
            className={`mt-4 rounded-lg border p-3 text-sm ${
              test.ok
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-red-200 bg-red-50 text-red-700'
            }`}
          >
            {test.ok
              ? `Подключение работает · ${test.latencyMs} мс · ${test.model}`
              : `Ошибка: ${test.error ?? 'неизвестная'}`}
          </div>
        ) : null}
      </Card>

      <Card>
        <CardTitle>Аудио</CardTitle>
        <CardDescription>
          Максимальный размер аудиофайла, который принимает Viber-бот. Лимит проверяется по
          исходному размеру аудио, а не по base64-копии в запросе. Допустимо от 1 до 20 МБ;
          изменение применяется к следующим загрузкам.
        </CardDescription>
        {generalSettings.isPending ? (
          <p className="mt-4 text-sm text-zinc-500">Загружаю лимит…</p>
        ) : generalSettings.isError || !generalSettings.data ? (
          <div className="mt-4">
            <ErrorState
              message={toRussianError(generalSettings.error, 'Не удалось загрузить лимит аудио')}
              onRetry={() => void generalSettings.refetch()}
            />
          </div>
        ) : (
          <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,320px)_1fr] md:items-end">
            <label className="block text-sm text-zinc-600">
              Максимальный размер, МБ
              <Input
                className="mt-1"
                type="number"
                min={AUDIO_MAX_MB_MIN}
                max={AUDIO_MAX_MB_MAX}
                step={1}
                value={audioMaxMb}
                onChange={(event) => {
                  setAudioMaxMb(event.target.value);
                  setAudioDirty(true);
                  setError(null);
                  setNotice(null);
                }}
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={saveAudio} disabled={saveAudioLimit.isPending || !audioDirty}>
                {saveAudioLimit.isPending ? 'Сохраняю…' : 'Сохранить лимит'}
              </Button>
              <span className="text-xs text-zinc-500">
                {audioDirty
                  ? 'Есть несохранённые изменения'
                  : `Обновлено ${formatDateTime(generalSettings.data.updatedAt)}`}
              </span>
            </div>
          </div>
        )}
      </Card>

      <Card>
        <CardTitle>Что будет использовать ИИ</CardTitle>
        <CardDescription>
          Сейчас модуль готовит только аудиозаметки: расшифровка приходит из Viber-бота, ИИ делает
          summary и структурированный Markdown, оригинал аудио прикрепляется к заметке. Текст
          расшифровки отправляется в DeepSeek только при включённом модуле.
        </CardDescription>
      </Card>
    </div>
  );
}
