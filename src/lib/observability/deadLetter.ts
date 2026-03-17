import type { JobType } from "bullmq";
import { channelRepo } from "@/lib/db/channelRepo";
import {
    getInboundDeadLetterQueue,
    getInboundMessageQueue,
    getOutboundDeadLetterQueue,
    getOutboundSendQueue,
    type DeadLetterJob,
    type InboundMessageJob,
    type OutboundSendJob,
} from "@/lib/queue/messageQueue";

type DeadLetterState = "wait" | "active" | "delayed" | "failed" | "completed";

const DLQ_COUNT_STATES: DeadLetterState[] = ["wait", "active", "delayed", "failed", "completed"];
const DLQ_LIST_STATES: DeadLetterState[] = ["wait", "active", "delayed", "failed"];

type DeadLetterStateCount = Record<DeadLetterState, number>;

export type DeadLetterQueueJobView<TPayload = Record<string, unknown>> = {
    id: string;
    queueName: string;
    state: DeadLetterState;
    data: DeadLetterJob<TPayload>;
    attemptsMade: number;
    failedReason: string | undefined;
    timestamp: number;
};

export type WorkspaceDeadLetterSnapshot = {
    workspaceId: string;
    inbound: {
        queueName: string;
        counts: DeadLetterStateCount;
        jobs: DeadLetterQueueJobView<InboundMessageJob>[];
    };
    outbound: Array<{
        channelId: string;
        channelName: string;
        queueName: string;
        counts: DeadLetterStateCount;
        jobs: DeadLetterQueueJobView<OutboundSendJob>[];
    }>;
};

function createEmptyCounts(): DeadLetterStateCount {
    return {
        wait: 0,
        active: 0,
        delayed: 0,
        failed: 0,
        completed: 0,
    };
}

async function listJobsByState<TPayload>(
    queue: { getJobs(states: JobType[], start: number, end: number): Promise<Array<{
        id?: string | number;
        queueName: string;
        data: unknown;
        attemptsMade: number;
        failedReason: string | undefined;
        timestamp: number;
    }>> },
    states: DeadLetterState[],
    limit: number
): Promise<Array<DeadLetterQueueJobView<TPayload>>> {
    const jobsPerState = await Promise.all(
        states.map(async (state) => {
            const jobs = await queue.getJobs([state], 0, limit);
            return jobs.map((job) => ({
                id: String(job.id),
                queueName: job.queueName,
                state,
                data: job.data as DeadLetterJob<TPayload>,
                attemptsMade: job.attemptsMade,
                failedReason: job.failedReason,
                timestamp: job.timestamp,
            }));
        })
    );

    return jobsPerState
        .flat()
        .sort((a, b) => b.timestamp - a.timestamp);
}

export async function listWorkspaceDeadLetters(
    workspaceId: string,
    limit: number
): Promise<WorkspaceDeadLetterSnapshot> {
    const normalizedLimit = Math.max(1, Math.min(200, Math.round(limit)));
    const inboundDlq = getInboundDeadLetterQueue();
    const channels = await channelRepo.listWorkspaceChannels(workspaceId);

    const [inboundJobsByState, outboundByChannel] = await Promise.all([
        Promise.all(
            DLQ_COUNT_STATES.map(async (state) => {
                const jobs = await inboundDlq.getJobs([state], 0, Math.max(normalizedLimit * 4, 200));
                return {
                    state,
                    jobs: jobs.filter((job) => {
                        const data = job.data as DeadLetterJob<InboundMessageJob> | undefined;
                        return data?.workspaceId === workspaceId;
                    }),
                };
            })
        ),
        Promise.all(channels.map(async (channel) => {
            const queue = getOutboundDeadLetterQueue(workspaceId, channel.id);
            const [counts, jobs] = await Promise.all([
                queue.getJobCounts(...DLQ_COUNT_STATES),
                listJobsByState<OutboundSendJob>(queue, DLQ_LIST_STATES, normalizedLimit),
            ]);

            return {
                channelId: channel.id,
                channelName: channel.name,
                queueName: queue.name,
                counts: {
                    wait: counts.wait || 0,
                    active: counts.active || 0,
                    delayed: counts.delayed || 0,
                    failed: counts.failed || 0,
                    completed: counts.completed || 0,
                },
                jobs: jobs.slice(0, normalizedLimit),
            };
        })),
    ]);

    const inboundCounts = createEmptyCounts();
    const inboundJobs = inboundJobsByState
        .flatMap(({ state, jobs }) => {
            inboundCounts[state] = jobs.length;
            return jobs.map((job) => ({
                id: String(job.id),
                queueName: job.queueName,
                state,
                data: job.data as DeadLetterJob<InboundMessageJob>,
                attemptsMade: job.attemptsMade,
                failedReason: job.failedReason,
                timestamp: job.timestamp,
            }));
        })
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, normalizedLimit);

    return {
        workspaceId,
        inbound: {
            queueName: inboundDlq.name,
            counts: inboundCounts,
            jobs: inboundJobs,
        },
        outbound: outboundByChannel,
    };
}

export async function replayWorkspaceDeadLetter(input: {
    workspaceId: string;
    direction: "inbound" | "outbound";
    dlqJobId: string;
    channelId?: string;
}) {
    if (input.direction === "inbound") {
        const inboundDlq = getInboundDeadLetterQueue();
        const dlqJob = await inboundDlq.getJob(input.dlqJobId);
        if (!dlqJob) {
            throw new Error("DLQ job tidak ditemukan");
        }

        const data = dlqJob.data as DeadLetterJob<InboundMessageJob>;
        if (!data.workspaceId || data.workspaceId !== input.workspaceId || !data.channelId) {
            throw new Error("DLQ job bukan milik workspace ini");
        }

        const inboundQueue = getInboundMessageQueue(data.workspaceId, data.channelId);
        await inboundQueue.add(`replay:${data.channelId}:${Date.now()}`, {
            ...data.payload,
            enqueuedAt: Date.now(),
            traceId: data.traceId || data.payload.traceId,
            correlationId: data.correlationId || data.payload.correlationId,
        });
        await dlqJob.remove();

        return {
            direction: input.direction,
            dlqJobId: input.dlqJobId,
            queueName: inboundQueue.name,
            channelId: data.channelId,
        };
    }

    if (!input.channelId) {
        throw new Error("channelId wajib diisi untuk replay outbound");
    }

    const channel = await channelRepo.getWorkspaceChannel(input.workspaceId, input.channelId);
    if (!channel) {
        throw new Error("Channel tidak ditemukan");
    }

    const outboundDlq = getOutboundDeadLetterQueue(input.workspaceId, channel.id);
    const dlqJob = await outboundDlq.getJob(input.dlqJobId);
    if (!dlqJob) {
        throw new Error("DLQ job tidak ditemukan");
    }

    const data = dlqJob.data as DeadLetterJob<OutboundSendJob>;
    if (!data.workspaceId || data.workspaceId !== input.workspaceId) {
        throw new Error("DLQ job bukan milik workspace ini");
    }

    const outboundQueue = getOutboundSendQueue(input.workspaceId, data.channelId || channel.id);
    await outboundQueue.add(`replay:${channel.id}:${Date.now()}`, {
        ...data.payload,
        requestedAt: Date.now(),
        traceId: data.traceId || data.payload.traceId,
        correlationId: data.correlationId || data.payload.correlationId,
        channelId: data.channelId || data.payload.channelId || channel.id,
    });
    await dlqJob.remove();

    return {
        direction: input.direction,
        dlqJobId: input.dlqJobId,
        queueName: outboundQueue.name,
        channelId: channel.id,
    };
}
