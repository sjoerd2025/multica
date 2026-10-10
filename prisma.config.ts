import { defineConfig as composer } from "@prisma/composer/config";
import { nextjsBuild } from "@prisma/composer/nextjs/control";
import { nodeBuild } from "@prisma/composer/node/control";
import { prismaCloud, prismaState } from "@prisma/composer-prisma-cloud/control";
import { definePrismaConfig } from "prisma/config";

export default definePrismaConfig({
  composer: composer({
    extensions: [prismaCloud({ region: "eu-central-1" }), nodeBuild(), nextjsBuild()],
    state: prismaState(),
  }),
});
