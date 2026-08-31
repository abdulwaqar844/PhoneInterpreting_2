import { TimeSlots } from './timeSlots';

export const weekDayTimeSlot: Record<
number,
TimeSlots
> = Object.freeze({
    0: 'sunday_time_slots',
    1: 'monday_time_slots',
    2: 'tuesday_time_slots',
    3: 'wednesday_time_slots',
    4: 'thursday_time_slots',
    5: 'friday_time_slots',
    6: 'saturday_time_slots',
});
