-- ==============================================================================
-- TRADE TRENDS: SUPABASE RLS POLICIES
-- Execute this script in your Supabase SQL Editor.
-- ==============================================================================

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

-- ==============================================================================
-- PROFILES TABLE POLICIES
-- ==============================================================================

-- 1. Anyone can read profiles (Public Read)
CREATE POLICY "Public profiles are viewable by everyone" 
ON public.profiles FOR SELECT 
USING ( true );

-- 2. Users can only insert their own profile
CREATE POLICY "Users can insert their own profile" 
ON public.profiles FOR INSERT 
WITH CHECK ( auth.uid() = id );

-- 3. Users can only update their own profile
CREATE POLICY "Users can update their own profile" 
ON public.profiles FOR UPDATE 
USING ( auth.uid() = id )
WITH CHECK ( auth.uid() = id );

-- ==============================================================================
-- MESSAGES TABLE POLICIES
-- ==============================================================================

-- 1. Anyone can read chat messages (Public Read)
CREATE POLICY "Messages are viewable by everyone" 
ON public.messages FOR SELECT 
USING ( true );

-- 2. Authenticated users can only insert messages belonging to themselves
CREATE POLICY "Authenticated users can insert their own messages" 
ON public.messages FOR INSERT 
TO authenticated 
WITH CHECK ( auth.uid() = user_id );

-- Note: No UPDATE or DELETE policies are provided for messages. 
-- This ensures the chat log is append-only and cannot be altered.

-- ==============================================================================
-- ROOMS TABLE POLICIES (GAME ARENA)
-- ==============================================================================

-- WARNING: The game logic uses anonymous client-side UUIDs for players. 
-- To allow the game to function without requiring users to log in, 
-- these policies must be fully public.

-- 1. Rooms are viewable by everyone (Public Read)
CREATE POLICY "Rooms are viewable by everyone" 
ON public.rooms FOR SELECT 
USING ( true );

-- 2. Anyone can create a room (Public Insert)
CREATE POLICY "Anyone can create a room" 
ON public.rooms FOR INSERT 
WITH CHECK ( true );

-- 3. Anyone can update a room (Public Update)
CREATE POLICY "Anyone can update a room" 
ON public.rooms FOR UPDATE 
USING ( true )
WITH CHECK ( true );

-- 4. Anyone can delete a room (Public Delete - Needed for disbanding rooms)
CREATE POLICY "Anyone can delete a room" 
ON public.rooms FOR DELETE 
USING ( true );
