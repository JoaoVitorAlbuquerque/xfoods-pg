import { Module } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { LeadsController } from './leads.controller';
import { ValidateLeadOwnershipService } from './services/validate-lead-ownership.service';

@Module({
  controllers: [LeadsController],
  providers: [LeadsService, ValidateLeadOwnershipService],
  exports: [ValidateLeadOwnershipService],
})
export class LeadsModule {}
