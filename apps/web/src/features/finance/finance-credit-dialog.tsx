import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { createFinanceCreditDrawdown } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { useState } from 'react';
import type { FinanceAccountWithBalance, FinanceCurrency } from '@nexter/contracts';

function today(): string {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function FinanceCreditDialog({
  accounts,
  onClose,
  onSaved,
}: {
  accounts: FinanceAccountWithBalance[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const creditAccounts = accounts.filter(
    (account) => account.kind === 'credit' && !account.archivedAt,
  );
  const destinationAccounts = accounts.filter(
    (account) => account.kind !== 'credit' && !account.archivedAt,
  );
  const [mode, setMode] = useState<'existing' | 'new'>(
    creditAccounts.length > 0 ? 'existing' : 'new',
  );
  const [creditAccountId, setCreditAccountId] = useState(creditAccounts[0]?.id ?? '');
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState<FinanceCurrency>('BYN');
  const [fxRate, setFxRate] = useState('1');
  const [amount, setAmount] = useState('');
  const [occurredOn, setOccurredOn] = useState(today());
  const [destinationAccountId, setDestinationAccountId] = useState('');
  const [destinationAmount, setDestinationAmount] = useState('');
  const [description, setDescription] = useState('Получение кредита');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const selectedCredit = creditAccounts.find((account) => account.id === creditAccountId);
  const selectedDestination = destinationAccounts.find(
    (account) => account.id === destinationAccountId,
  );
  const creditCurrency = mode === 'existing' ? selectedCredit?.currency : currency;
  const currenciesDiffer =
    Boolean(selectedDestination) && selectedDestination?.currency !== creditCurrency;

  async function save(): Promise<void> {
    if (!amount.trim() || (mode === 'new' && !name.trim())) {
      setError('Заполните сумму и название кредита.');
      return;
    }
    if (mode === 'new' && currency !== 'BYN' && !fxRate.trim()) {
      setError('Укажите курс кредита к BYN.');
      return;
    }
    if (currenciesDiffer && !destinationAmount.trim()) {
      setError('Укажите сумму зачисления в валюте счёта.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await createFinanceCreditDrawdown({
        ...(mode === 'existing'
          ? { creditAccountId }
          : {
              name: name.trim(),
              currency,
              fxRate: currency === 'BYN' ? '1' : fxRate,
            }),
        amount,
        occurredOn,
        destinationAccountId: destinationAccountId || null,
        ...(currenciesDiffer ? { destinationAmount } : {}),
        description: description.trim() || null,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(toRussianError(err, 'Не удалось оформить получение кредита'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Получить кредит"
      description="Увеличивает долг, но не попадает в доходы и расходы. Если деньги пришли на счёт — выбери его, чтобы увеличить и баланс."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? 'Сохраняю…' : 'Получить кредит'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex gap-1 rounded-xl border border-zinc-200 bg-zinc-50 p-1">
          <button
            type="button"
            onClick={() => setMode('existing')}
            disabled={creditAccounts.length === 0}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              mode === 'existing' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'
            } disabled:opacity-40`}
          >
            Существующий кредит
          </button>
          <button
            type="button"
            onClick={() => setMode('new')}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              mode === 'new' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'
            }`}
          >
            Новый кредит
          </button>
        </div>

        {mode === 'existing' ? (
          <label className="block text-sm text-zinc-600">
            Кредитный счёт
            <Select
              className="mt-1"
              value={creditAccountId}
              onChange={(event) => setCreditAccountId(event.target.value)}
            >
              {creditAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} · {account.currency} · долг {account.balance}
                </option>
              ))}
            </Select>
          </label>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-zinc-600">
              Название
              <Input
                className="mt-1"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Кредит на автомобиль"
              />
            </label>
            <label className="block text-sm text-zinc-600">
              Валюта
              <Select
                className="mt-1"
                value={currency}
                onChange={(event) => {
                  const next = event.target.value as FinanceCurrency;
                  setCurrency(next);
                  setFxRate(next === 'BYN' ? '1' : '');
                }}
              >
                <option value="BYN">BYN</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </Select>
            </label>
            {currency !== 'BYN' ? (
              <label className="block text-sm text-zinc-600">
                Курс к BYN
                <Input
                  className="mt-1"
                  inputMode="decimal"
                  value={fxRate}
                  onChange={(event) => setFxRate(event.target.value)}
                  placeholder="2.965"
                />
              </label>
            ) : null}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm text-zinc-600">
            Сумма кредита
            <Input
              className="mt-1"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="5000.00"
            />
          </label>
          <label className="block text-sm text-zinc-600">
            Дата
            <Input
              className="mt-1"
              type="date"
              value={occurredOn}
              onChange={(event) => setOccurredOn(event.target.value)}
            />
          </label>
        </div>

        <label className="block text-sm text-zinc-600">
          Куда зачислить деньги
          <Select
            className="mt-1"
            value={destinationAccountId}
            onChange={(event) => {
              setDestinationAccountId(event.target.value);
              setDestinationAmount('');
            }}
          >
            <option value="">Не зачислять — только увеличить долг</option>
            {destinationAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} · {account.currency}
              </option>
            ))}
          </Select>
        </label>

        {currenciesDiffer ? (
          <label className="block text-sm text-zinc-600">
            Сумма зачисления в {selectedDestination?.currency}
            <Input
              className="mt-1"
              inputMode="decimal"
              value={destinationAmount}
              onChange={(event) => setDestinationAmount(event.target.value)}
              placeholder="0.00"
            />
          </label>
        ) : null}

        <label className="block text-sm text-zinc-600">
          Описание
          <Input
            className="mt-1"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Необязательно"
          />
        </label>

        {mode === 'existing' && selectedCredit ? (
          <p className="text-xs text-zinc-500">
            Текущий долг: {selectedCredit.balance.replace('-', '')} {selectedCredit.currency}. Долг
            увеличится на {amount || '0'}.
          </p>
        ) : null}
        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
