import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CustomRequest } from '@common/authentication/authentication.dto';
import { AuthGuard } from '@common/authentication/authentication.guard';
import { ApiOkResponseData } from '@common/response/api-response.decorator';
import { routes, subRoutes } from '@shared/variables';
import {
  CopilotMessageDTO,
  GetCopilotMessagesQueryDTO,
  SendCopilotMessageBodyDTO,
} from './copilot.dto';
import { CopilotService } from './copilot.service';

@ApiTags('Copilot')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard)
@Controller(routes.copilot)
export class CopilotController {
  constructor(private readonly copilotService: CopilotService) {}

  @Get(subRoutes.messages)
  @HttpCode(200)
  @ApiOperation({
    summary: 'List the user’s chat history with Copilot (oldest first)',
  })
  @ApiOkResponseData(CopilotMessageDTO, { isArray: true })
  listMessages(
    @Query() query: GetCopilotMessagesQueryDTO,
    @Req() req: CustomRequest,
  ) {
    return this.copilotService.listMessages(query, req);
  }

  @Post(subRoutes.messages)
  @HttpCode(201)
  @ApiOperation({
    summary: 'Send a message to Copilot, get the assistant reply',
    description:
      'Persists both the user message and the assistant reply. Returns 503 if ANTHROPIC_API_KEY is not configured.',
  })
  sendMessage(
    @Body() body: SendCopilotMessageBodyDTO,
    @Req() req: CustomRequest,
  ) {
    return this.copilotService.sendMessage(body, req);
  }

  @Delete(subRoutes.messages)
  @HttpCode(200)
  @ApiOperation({ summary: 'Clear the user’s entire chat history' })
  clearMessages(@Req() req: CustomRequest) {
    return this.copilotService.clearMessages(req);
  }
}
