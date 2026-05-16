import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CustomRequest } from '@common/authentication/authentication.dto';
import { AuthGuard } from '@common/authentication/authentication.guard';
import { ApiOkResponseData } from '@common/response/api-response.decorator';
import { CopilotContextResponseDTO } from '@common/response/copilot/copilot-context.dto';
import { routes, subRoutes } from '@shared/variables';
import {
  CopilotChatDTO,
  CopilotChatParamDTO,
  CopilotMessageDTO,
  CreateCopilotChatBodyDTO,
  GetCopilotMessagesQueryDTO,
  RenameCopilotChatBodyDTO,
  SendCopilotMessageBodyDTO,
} from './copilot.dto';
import { CopilotService } from './copilot.service';

@ApiTags('Copilot')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard)
@Controller(routes.copilot)
export class CopilotController {
  constructor(private readonly copilotService: CopilotService) {}

  // ─── Chats ───────────────────────────────────────────────────────────────

  @Get(subRoutes.chats)
  @HttpCode(200)
  @ApiOperation({ summary: 'List the user’s chats (most-recent first)' })
  @ApiOkResponseData(CopilotChatDTO, { isArray: true })
  listChats(@Req() req: CustomRequest) {
    return this.copilotService.listChats(req);
  }

  @Post(subRoutes.chats)
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a new chat' })
  @ApiOkResponseData(CopilotChatDTO)
  createChat(
    @Body() body: CreateCopilotChatBodyDTO,
    @Req() req: CustomRequest,
  ) {
    return this.copilotService.createChat(body, req);
  }

  @Patch(`${subRoutes.chats}/:chatId`)
  @HttpCode(200)
  @ApiOperation({ summary: 'Rename a chat' })
  @ApiOkResponseData(CopilotChatDTO)
  renameChat(
    @Param() params: CopilotChatParamDTO,
    @Body() body: RenameCopilotChatBodyDTO,
    @Req() req: CustomRequest,
  ) {
    return this.copilotService.renameChat(params.chatId, body, req);
  }

  @Delete(`${subRoutes.chats}/:chatId`)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Delete a chat and its messages',
    description:
      'If the user deletes their last chat, the next POST auto-creates a fresh default.',
  })
  deleteChat(
    @Param() params: CopilotChatParamDTO,
    @Req() req: CustomRequest,
  ) {
    return this.copilotService.deleteChat(params.chatId, req);
  }

  @Get(`${subRoutes.chats}/:chatId${subRoutes.messages}`)
  @HttpCode(200)
  @ApiOperation({ summary: 'List messages in a specific chat (oldest first)' })
  @ApiOkResponseData(CopilotMessageDTO, { isArray: true })
  listChatMessages(
    @Param() params: CopilotChatParamDTO,
    @Query() query: GetCopilotMessagesQueryDTO,
    @Req() req: CustomRequest,
  ) {
    return this.copilotService.listMessages(params.chatId, query, req);
  }

  @Post(`${subRoutes.chats}/:chatId${subRoutes.messages}`)
  @HttpCode(201)
  @ApiOperation({ summary: 'Send a message to Copilot inside a specific chat' })
  sendChatMessage(
    @Param() params: CopilotChatParamDTO,
    @Body() body: SendCopilotMessageBodyDTO,
    @Req() req: CustomRequest,
  ) {
    return this.copilotService.sendMessage(params.chatId, body, req);
  }

  @Delete(`${subRoutes.chats}/:chatId${subRoutes.messages}`)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Clear all messages in a specific chat (keeps the chat row)',
  })
  clearChatMessages(
    @Param() params: CopilotChatParamDTO,
    @Req() req: CustomRequest,
  ) {
    return this.copilotService.clearMessages(params.chatId, req);
  }

  // ─── Default-chat fallback endpoints ─────────────────────────────────────
  // Target the user's most-recent chat. POST auto-creates a default chat when
  // none exists. Kept for backward compatibility with clients that don't yet
  // know about /chats/:chatId.

  @Get(subRoutes.messages)
  @HttpCode(200)
  @ApiOperation({
    summary: 'List messages from the user’s most-recent chat (oldest first)',
  })
  @ApiOkResponseData(CopilotMessageDTO, { isArray: true })
  listMessages(
    @Query() query: GetCopilotMessagesQueryDTO,
    @Req() req: CustomRequest,
  ) {
    return this.copilotService.listMessages(undefined, query, req);
  }

  @Post(subRoutes.messages)
  @HttpCode(201)
  @ApiOperation({
    summary: 'Send a message to Copilot, get the assistant reply',
    description:
      'Targets the user’s most-recent chat, or creates a default chat if none exists. Returns 503 if ANTHROPIC_API_KEY is not configured.',
  })
  sendMessage(
    @Body() body: SendCopilotMessageBodyDTO,
    @Req() req: CustomRequest,
  ) {
    return this.copilotService.sendMessage(undefined, body, req);
  }

  @Delete(subRoutes.messages)
  @HttpCode(200)
  @ApiOperation({ summary: 'Clear the user’s entire chat history' })
  clearMessages(@Req() req: CustomRequest) {
    return this.copilotService.clearMessages(undefined, req);
  }

  // ─── Context ─────────────────────────────────────────────────────────────

  @Get(subRoutes.context)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Roll-up of the data Copilot sees about the user',
    description:
      'One call replaces /analysis/health + /analysis/summary + /analysis/recommendations + obligations + live buffer. Used by WalletCopilotCard and CopilotContextRail.',
  })
  @ApiOkResponseData(CopilotContextResponseDTO)
  getContext(@Req() req: CustomRequest) {
    return this.copilotService.getContext(req);
  }
}
