import { useState, useEffect, useCallback } from "react";
import { supabase } from './supabase';
import { DEFAULT_VENUE, mapEvent, mapVenue } from './utils';

const useStorage = () => {
  const [venues, setVenues] = useState([DEFAULT_VENUE]);
  const [events, setEvents] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const load = async () => {
      const { data: venueRows } = await supabase.from('tenants').select('*');
      if (venueRows?.length) setVenues(venueRows.map(mapVenue));

      const { data: eventsData, error: eventsError } = await supabase
        .from('events')
        .select('*, ticket_types(*)')
        .order('event_date', { ascending: true });

      if (eventsError) console.error(eventsError);
      else setEvents((eventsData || []).map(mapEvent));

      setLoaded(true);
    };
    load();

    const handleVisibility = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  const updateEvents = useCallback((d) => setEvents(d), []);
  const updateVenues = useCallback((d) => setVenues(d), []);

  return { venues, events, loaded, updateEvents, updateVenues };
};

export default useStorage;
