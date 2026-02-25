import { Tool } from "./registry";
import { userRepo } from "../../lib/db/userRepo";
import { memoryRepo } from "../../lib/db/memoryRepo";

/**
 * Tool: get_user_info — Retrieves user information from the database.
 */
export const getUserInfoTool: Tool = {
    name: "get_user_info",
    description: "Ambil informasi dan memori user dari database berdasarkan nomor telepon",
    parameters: {
        type: "object",
        properties: {
            phoneNumber: {
                type: "string",
                description: "Nomor telepon user (tanpa @s.whatsapp.net)",
            },
        },
        required: ["phoneNumber"],
    },
    execute: async (params) => {
        const user = await userRepo.getUserByPhone(params.phoneNumber);
        if (!user) {
            return "User tidak ditemukan di database.";
        }

        const memories = await memoryRepo.getMemoriesByUser(user.id);
        const memoryStr = memories.length > 0
            ? memories.map((m) => `  ${m.key}: ${m.value}`).join("\n")
            : "  (belum ada memori)";

        return `User Info:
  Nama: ${user.name ?? "Belum diketahui"}
  Nomor: ${user.phoneNumber}
  Label: ${user.label ?? "-"}
  Status: ${user.isBlocked ? "Blocked" : "Active"}
  
Memori:
${memoryStr}`;
    },
};

/**
 * Tool: save_note — Saves a fact/note about the user to long-term memory.
 */
export const saveNoteTool: Tool = {
    name: "save_note",
    description: "Simpan catatan/fakta baru tentang user ke memori jangka panjang",
    parameters: {
        type: "object",
        properties: {
            key: {
                type: "string",
                description: "Kategori fakta, misalnya: name, city, university, major, scholarship_target",
            },
            value: {
                type: "string",
                description: "Nilai/isi dari fakta tersebut",
            },
        },
        required: ["key", "value"],
    },
    execute: async (params, context) => {
        await memoryRepo.upsertMemory({
            userId: context.userId,
            key: params.key,
            value: params.value,
        });
        return `Berhasil menyimpan: ${params.key} = ${params.value}`;
    },
};
