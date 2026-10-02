export interface BestTime {
    time: string;
    driver: string;
}

export interface SessionBests {
    lap: BestTime;
    s1: BestTime;
    s2: BestTime;
    s3: BestTime;
}