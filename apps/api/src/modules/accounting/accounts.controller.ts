import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AccountsResponse, Account } from '@nexter/contracts';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { AuthContext } from '../auth/auth.types';
import { AccountsService } from './accounts.service';

@ApiTags('accounting')
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  async list(@CurrentAuth() auth: AuthContext): Promise<AccountsResponse> {
    return { accounts: await this.accounts.list(auth.user.id) };
  }

  @Get(':id')
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Account> {
    return this.accounts.get(auth.user.id, id);
  }
}
