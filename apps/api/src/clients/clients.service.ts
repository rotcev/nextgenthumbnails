import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { DEFAULT_USER_ID } from "../bootstrap/bootstrap.constants";
import { CreateClientDto } from "./dto/create-client.dto";
import { UpdateClientDto } from "./dto/update-client.dto";
import { asPrismaJson } from "../prisma/prisma-json";

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    return this.prisma.client.findMany({
      where: { userId: DEFAULT_USER_ID },
      orderBy: { updatedAt: "desc" },
    });
  }

  async getById(id: string) {
    const client = await this.prisma.client.findFirst({
      where: { id, userId: DEFAULT_USER_ID },
    });
    if (!client) throw new NotFoundException("Client not found");
    return client;
  }

  async create(dto: CreateClientDto) {
    return this.prisma.client.create({
      data: {
        userId: DEFAULT_USER_ID,
        name: dto.name,
        timezone: dto.timezone,
        primaryColor: dto.primaryColor,
        defaults: asPrismaJson(dto.defaults),
      },
    });
  }

  async update(id: string, dto: UpdateClientDto) {
    await this.getById(id);

    return this.prisma.client.update({
      where: { id },
      data: {
        name: dto.name,
        timezone: dto.timezone,
        primaryColor: dto.primaryColor,
        defaults: dto.defaults ? asPrismaJson(dto.defaults) : undefined,
      },
    });
  }
}


