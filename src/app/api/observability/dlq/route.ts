import type { JobType } from "bullmq";
import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiSession";
import {
    getInboundDeadLetterQueue,
    getInboundMessageQueue,
    getOutboundDeadLetterQueue,
    getOutboundSendQueue,
    type DeadLetterJob,
    type InboundMessageJob,
    type OutboundSendJob,
} from "@/lib/queue/messageQueue";
import { channelRepo } from "@/lib/db/channelRepo";

export const runtime = "nodejs";

const DLQ_STATES: JobType[] = ["wait", "active", "delayed", "failed"];

function readString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function readLimit(request: NextRequest): number {
    const raw = Number(request.nextUrl.searchParams.get("limit"));
    if (!Number.isFinite(raw)) {
        return 50;
    }
    return Math.max(1, Math.min(200, Math.round(raw)));
}

export async function GET(request: NextRequest) {
    const auth = await requireApiSession("read");
    if (!auth.ok) {
        return auth.response;
    }

    const limit = readLimit(request);
    const inboundDlq = getInboundDeadLetterQueue();
    const channels = await channelRepo.listWorkspaceChannels(auth.context.workspaceId);

    const [inboundCounts, inboundJobs, outboundByChannel] = await Promise.all([
        inboundDlq.getJobCounts("wait", "active", "delayed", "failed", "completed"),
        inboundDlq.getJobs(DLQ_STATES, 0, Math.max(limit * 4, 200)),
        Promise.all(channels.map(async (channel) => {
            const queue = getOutboundDeadLetterQueue(auth.context.workspaceId, channel.id);
            const [counts, jobs] = await Promise.all([
                queue.getJobCounts("wait", "active", "delayed", "failed", "completed"),
                queue.getJobs(DLQ_STATES, 0, limit),
            ]);
            return {
                channelId: channel.id,
                channelName: channel.name,
                queueName: queue.name,
                counts,
                jobs,
            };
        })),
    ]);

    const workspaceInboundJobs = inboundJobs
        .filter((job) => (job.data as DeadLetterJob<InboundMessageJob> | undefined)?.workspaceId === auth.context.workspaceId)
        .slice(0, limit)
        .map((job) => ({
            id: String(job.id),
            queueName: job.queueName,
            data: job.data,
            attemptsMade: job.attemptsMade,
            failedReason: job.failedReason,
            timestamp: job.timestamp,
        }));

    const outboundChannels = outboundByChannel.map((entry) => ({
        channelId: entry.channelId,
        channelName: entry.channelName,
        queueName: entry.queueName,
        counts: entry.counts,
        jobs: entry.jobs.map((job) => ({
            id: String(job.id),
            queueName: job.queueName,
            data: job.data,
            attemptsMade: job.attemptsMade,
            failedReason: job.failedReason,
            timestamp: job.timestamp,
        })),
    }));

    return NextResponse.json({
        success: true,
        data: {
            workspaceId: auth.context.workspaceId,
            inbound: {
                queueName: inboundDlq.name,
                counts: inboundCounts,
                jobs: workspaceInboundJobs,
            },
            outbound: outboundChannels,
        },
    });
}

export async function POST(request: NextRequest) {
    const auth = await requireApiSession("manage_channel");
    if (!auth.ok) {
        return auth.response;
    }

    let payload: Record<string, unknown> = {};
    try {
        payload = await request.json() as Record<string, unknown>;
    } catch {
        payload = {};
    }

    const direction = readString(payload.direction).toLowerCase();
    const dlqJobId = readString(payload.dlqJobId);

    if (!dlqJobId || (direction !== "inbound" && direction !== "outbound")) {
        return NextResponse.json(
            {
                success: false,
                message: "direction (inbound|outbound) dan dlqJobId wajib diisi",
            },
            { status: 400 }
        );
    }

    if (direction === "inbound") {
        const inboundDlq = getInboundDeadLetterQueue();
        const dlqJob = await inboundDlq.getJob(dlqJobId);
        if (!dlqJob) {
            return NextResponse.json({ success: false, message: "DLQ job tidak ditemukan" }, { status: 404 });
        }

        const data = dlqJob.data as DeadLetterJob<InboundMessageJob>;
        if (!data.workspaceId || data.workspaceId !== auth.context.workspaceId || !data.channelId) {
            return NextResponse.json({ success: false, message: "DLQ job bukan milik workspace ini" }, { status: 403 });
        }

        const inboundQueue = getInboundMessageQueue(data.workspaceId, data.channelId);
        await inboundQueue.add(`replay:${data.channelId}:${Date.now()}`, {
            ...data.payload,
            enqueuedAt: Date.now(),
            traceId: data.traceId || data.payload.traceId,
            correlationId: data.correlationId || data.payload.correlationId,
        });

        await dlqJob.remove();

        return NextResponse.json({
            success: true,
            message: "Inbound DLQ job di-replay",
            data: {
                direction,
                dlqJobId,
                queueName: inboundQueue.name,
            },
        });
    }

    const channelId = readString(payload.channelId);
    if (!channelId) {
        return NextResponse.json({ success: false, message: "channelId wajib diisi untuk replay outbound" }, { status: 400 });
    }

    const channel = await channelRepo.getWorkspaceChannel(auth.context.workspaceId, channelId);
    if (!channel) {
        return NextResponse.json({ success: false, message: "Channel tidak ditemukan" }, { status: 404 });
    }

    const outboundDlq = getOutboundDeadLetterQueue(auth.context.workspaceId, channel.id);
    const dlqJob = await outboundDlq.getJob(dlqJobId);
    if (!dlqJob) {
        return NextResponse.json({ success: false, message: "DLQ job tidak ditemukan" }, { status: 404 });
    }

    const data = dlqJob.data as DeadLetterJob<OutboundSendJob>;
    if (!data.workspaceId || data.workspaceId !== auth.context.workspaceId) {
        return NextResponse.json({ success: false, message: "DLQ job bukan milik workspace ini" }, { status: 403 });
    }

    const outboundQueue = getOutboundSendQueue(data.workspaceId, data.channelId || channel.id);
    await outboundQueue.add(`replay:${channel.id}:${Date.now()}`, {
        ...data.payload,
        requestedAt: Date.now(),
        traceId: data.traceId || data.payload.traceId,
        correlationId: data.correlationId || data.payload.correlationId,
        channelId: data.channelId || data.payload.channelId || channel.id,
    });

    await dlqJob.remove();

    return NextResponse.json({
        success: true,
        message: "Outbound DLQ job di-replay",
        data: {
            direction,
            channelId: channel.id,
            dlqJobId,
            queueName: outboundQueue.name,
        },
    });
}
