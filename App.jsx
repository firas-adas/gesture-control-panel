
import React, { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Gesture Control Panel Widget
 * 
 * Improved gesture detection with reliable classification:
 * - Distance-from-wrist finger detection (threshold: 1.10)
 * - Rolling window of 5 frames with 3/5 majority vote
 * - Actions trigger on gesture change OR after 2s hold
 * 
 * Gestures (4 total):
 * - Open Palm → Stop
 * - Fist → Reset
 * - Peace Sign → Next
 * - Index Up → Confirm
 */

// Helper: Calculate 2D distance (x, y only for better reliability)
const distance2D = (p1, p2) => {
  return Math.sqrt(
    Math.pow(p1.x - p2.x, 2) + 
    Math.pow(p1.y - p2.y, 2)
  );
};

// Gesture classification using distance-from-wrist comparisons
const classifyGesture = (landmarks) => {
  if (!landmarks || landmarks.length !== 21) return 'Unknown';

  const wrist = landmarks[0];
  
  // Finger tips and PIP joints
  const indexTip = landmarks[8];
  const indexPIP = landmarks[6];
  const middleTip = landmarks[12];
  const middlePIP = landmarks[10];
  const ringTip = landmarks[16];
  const ringPIP = landmarks[14];
  const pinkyTip = landmarks[20];
  const pinkyPIP = landmarks[18];

  // Calculate distances from wrist
  const indexTipDist = distance2D(indexTip, wrist);
  const indexPIPDist = distance2D(indexPIP, wrist);
  const middleTipDist = distance2D(middleTip, wrist);
  const middlePIPDist = distance2D(middlePIP, wrist);
  const ringTipDist = distance2D(ringTip, wrist);
  const ringPIPDist = distance2D(ringPIP, wrist);
  const pinkyTipDist = distance2D(pinkyTip, wrist);
  const pinkyPIPDist = distance2D(pinkyPIP, wrist);

  // Finger extension detection: tip distance > pip distance * 1.10
  const EXTENSION_MULTIPLIER = 1.10;
  
  const indexExtended = indexTipDist > (indexPIPDist * EXTENSION_MULTIPLIER);
  const middleExtended = middleTipDist > (middlePIPDist * EXTENSION_MULTIPLIER);
  const ringExtended = ringTipDist > (ringPIPDist * EXTENSION_MULTIPLIER);
  const pinkyExtended = pinkyTipDist > (pinkyPIPDist * EXTENSION_MULTIPLIER);

  // Count extended fingers
  const extendedFingers = [indexExtended, middleExtended, ringExtended, pinkyExtended];
  const extendedCount = extendedFingers.filter(Boolean).length;

  // Classification rules (order matters - most specific first)
  
  // Index Up: only index extended, middle/ring/pinky NOT extended
  if (indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
    return 'Index Up';
  }

  // Peace Sign: index AND middle extended, ring AND pinky NOT extended
  if (indexExtended && middleExtended && !ringExtended && !pinkyExtended) {
    return 'Peace Sign';
  }

  // Open Palm: at least 4 fingers extended (all extended)
  if (extendedCount >= 4) {
    return 'Open Palm';
  }

  // Fist: none of the 4 fingers extended
  if (extendedCount === 0) {
    return 'Fist';
  }

  // Otherwise, unknown gesture
  return 'Unknown';
};

// Rolling window majority vote
// Returns the gesture that appears in at least minCount of the last windowSize frames
const getMajorityGesture = (gestureWindow, windowSize = 5, minCount = 3) => {
  if (gestureWindow.length < windowSize) return 'Unknown';

  const counts = {};
  gestureWindow.forEach(gesture => {
    if (gesture) {
      counts[gesture] = (counts[gesture] || 0) + 1;
    }
  });

  // Find gesture with at least minCount occurrences
  for (const [gesture, count] of Object.entries(counts)) {
    if (count >= minCount && gesture !== 'Unknown') {
      return gesture;
    }
  }

  return 'Unknown';
};

const GestureControlPanel = () => {
  // State
  const [cameraActive, setCameraActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [majorityThreshold, setMajorityThreshold] = useState(3); // Require 3/5 frames by default
  const [currentGesture, setCurrentGesture] = useState(null);
  const [lastAction, setLastAction] = useState(null);
  const [actionLog, setActionLog] = useState([]);
  const [mediapipeReady, setMediapipeReady] = useState(false);

  // Refs
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const handsRef = useRef(null);
  const cameraRef = useRef(null);
  const isInitializingRef = useRef(false); // Prevent multiple simultaneous initializations
  const gestureWindowRef = useRef([]); // Rolling window of last 5 gestures
  const stableGestureRef = useRef(null); // Current stable gesture (after majority vote)
  const gestureStartTimeRef = useRef(null); // When current stable gesture started
  const lastActionTimeRef = useRef(0); // For debouncing (1.5s)

  // Load MediaPipe Hands scripts
  useEffect(() => {
    if (typeof window.Hands !== 'undefined' && 
        typeof window.Camera !== 'undefined' && 
        typeof window.drawConnectors !== 'undefined') {
      setMediapipeReady(true);
      return;
    }

    const loadScript = (src, id) => {
      return new Promise((resolve, reject) => {
        // Check if already loaded
        if (document.getElementById(id)) {
          resolve();
          return;
        }
        
        const script = document.createElement('script');
        script.id = id;
        script.src = src;
        script.crossOrigin = 'anonymous';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    };

    // Load scripts sequentially to avoid timing issues
    loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils@0.3.1620248257/drawing_utils.js', 'mediapipe-drawing')
      .then(() => loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils@0.3.1640029074/camera_utils.js', 'mediapipe-camera'))
      .then(() => loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915/hands.js', 'mediapipe-hands'))
      .then(() => {
        // Wait a moment for libraries to fully initialize
        setTimeout(() => {
          setMediapipeReady(true);
        }, 500);
      })
      .catch((err) => {
        console.error('Failed to load MediaPipe scripts:', err);
      });
  }, []);

  // Start camera and hand detection
  const startCamera = useCallback(async () => {
    if (!mediapipeReady) {
      alert('MediaPipe is still loading. Please wait a moment.');
      return;
    }

    // Prevent multiple simultaneous initializations
    if (isInitializingRef.current) {
      return;
    }

    isInitializingRef.current = true;
    setLoading(true);
    setPermissionDenied(false);

    try {
      // Request camera access
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' }
      });

      streamRef.current = stream;
      
      // Set up video element and wait for it to be ready
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        
        // Wait for video to be ready before playing
        await new Promise((resolve, reject) => {
          videoRef.current.onloadedmetadata = () => {
            videoRef.current.play()
              .then(resolve)
              .catch(reject);
          };
          
          // Timeout fallback
          setTimeout(() => reject(new Error('Video load timeout')), 5000);
        });
      }

      // Reuse existing hands instance or create new one
      let hands = handsRef.current;
      
      if (!hands) {
        // Initialize MediaPipe Hands with proper asset loading
        hands = new window.Hands({
          locateFile: (file) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915/${file}`;
          }
        });

        hands.setOptions({
          maxNumHands: 1,
          modelComplexity: 1,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5
        });
        
        // Store hands reference before setting up onResults
        handsRef.current = hands;

        // Set up results handler
        hands.onResults((results) => {
          if (!canvasRef.current) return;
          
          const canvasCtx = canvasRef.current.getContext('2d');
          if (!canvasCtx) return;
          
          canvasCtx.save();
          canvasCtx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);

          // Draw video frame
          if (videoRef.current && videoRef.current.readyState >= 2) {
            try {
              canvasCtx.drawImage(videoRef.current, 0, 0, canvasRef.current.width, canvasRef.current.height);
            } catch (err) {
              // Ignore drawing errors
            }
          }

          // Process hand landmarks
          if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            const landmarks = results.multiHandLandmarks[0];
            
            // Draw hand landmarks
            try {
              window.drawConnectors(canvasCtx, landmarks, window.HAND_CONNECTIONS, {
                color: '#00FF00',
                lineWidth: 2
              });
              window.drawLandmarks(canvasCtx, landmarks, {
                color: '#FF0000',
                lineWidth: 1,
                radius: 3
              });
            } catch (err) {
              // Ignore drawing errors
            }

            // Classify gesture (returns gesture name including 'Unknown')
            const detectedGesture = classifyGesture(landmarks);
            
            // Add to rolling window (keep last 5)
            gestureWindowRef.current.push(detectedGesture);
            if (gestureWindowRef.current.length > 5) {
              gestureWindowRef.current.shift();
            }

            // Get stable gesture via majority vote (3/5)
            const stableGesture = getMajorityGesture(gestureWindowRef.current, 5, majorityThreshold);
            
            // Display current detection state
            setCurrentGesture(stableGesture);

            // Action triggering logic
            const now = Date.now();
            const timeSinceLastAction = now - lastActionTimeRef.current;
            const gestureChanged = stableGesture !== stableGestureRef.current && stableGesture !== 'Unknown';
            
            // Track when stable gesture started
            if (gestureChanged) {
              gestureStartTimeRef.current = now;
            }
            
            const gestureHoldTime = gestureStartTimeRef.current ? now - gestureStartTimeRef.current : 0;
            const holdingFor2Seconds = gestureHoldTime >= 2000;
            
            // Trigger action if: gesture changed OR holding same gesture for 2s, AND debounce passed
            const shouldTrigger = (gestureChanged || holdingFor2Seconds) && 
                                  timeSinceLastAction >= 1500 &&
                                  stableGesture !== 'Unknown';
            
            if (shouldTrigger) {
              // Map gesture to action
              const actionMap = {
                'Index Up': 'Confirm',
                'Open Palm': 'Stop',
                'Peace Sign': 'Next',
                'Fist': 'Reset'
              };

              const action = actionMap[stableGesture];
              if (action) {
                const actionEntry = {
                  gesture: stableGesture,
                  action: action,
                  timestamp: new Date().toLocaleTimeString()
                };
                
                setLastAction(actionEntry);
                setActionLog(prev => [actionEntry, ...prev.slice(0, 9)]); // Keep last 10
                
                lastActionTimeRef.current = now;
                
                // Reset hold timer after triggering
                if (holdingFor2Seconds) {
                  gestureStartTimeRef.current = now;
                }
              }
            }
            
            // Update stable gesture reference
            stableGestureRef.current = stableGesture;
          } else {
            setCurrentGesture('Unknown');
            // Clear window when no hand detected
            gestureWindowRef.current = [];
            stableGestureRef.current = null;
            gestureStartTimeRef.current = null;
          }

          canvasCtx.restore();
        });

        // Initialize MediaPipe Hands model (this loads the model files)
        await hands.initialize();
      }

      // Start processing camera frames after model is loaded
      const camera = new window.Camera(videoRef.current, {
        onFrame: async () => {
          if (handsRef.current && videoRef.current && videoRef.current.readyState >= 2) {
            try {
              await handsRef.current.send({ image: videoRef.current });
            } catch (err) {
              // Ignore send errors during shutdown
            }
          }
        },
        width: 640,
        height: 480
      });
      
      cameraRef.current = camera;
      await camera.start();

      setCameraActive(true);
      setLoading(false);
      isInitializingRef.current = false;
    } catch (err) {
      console.error('Camera access error:', err);
      isInitializingRef.current = false;
      
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setPermissionDenied(true);
      } else {
        // Check if it's the "File exists" error from MediaPipe
        if (err.message && err.message.includes('File exists')) {
          alert('MediaPipe initialization error. Please refresh the page and try again.');
        } else {
          alert('Failed to start camera: ' + err.message);
        }
      }
      setLoading(false);
      
      // Clean up on error
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    }
  }, [mediapipeReady, majorityThreshold]);

  // Stop camera
  const stopCamera = useCallback(() => {
    isInitializingRef.current = false;
    
    // Stop camera instance
    if (cameraRef.current) {
      try {
        cameraRef.current.stop();
      } catch (err) {
        // Ignore stop errors
      }
      cameraRef.current = null;
    }

    // Stop media stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    // Clear video element
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }

    // Note: We keep handsRef.current intact to reuse the MediaPipe instance
    // This prevents "File exists" errors on restart

    // Clear gesture detection state
    gestureWindowRef.current = [];
    stableGestureRef.current = null;
    gestureStartTimeRef.current = null;
    lastActionTimeRef.current = 0;

    setCameraActive(false);
    setCurrentGesture(null);
  }, []);

  // Clear log
  const clearLog = useCallback(() => {
    setActionLog([]);
    setLastAction(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  // Apply body background styling
  useEffect(() => {
    document.body.style.background = '#ffffff';
    document.body.style.fontFamily = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    document.documentElement.style.minHeight = '100%';
    return () => {
      document.body.style.background = '';
      document.body.style.fontFamily = '';
      document.documentElement.style.minHeight = '';
    };
  }, []);

  return (
    <div style={{
      minHeight: '100vh',
      background: '#ffffff',
      padding: '48px 32px',
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    }}>
      {/* Header */}
      <div style={{ maxWidth: '1200px', margin: '0 auto', marginBottom: '40px' }}>
        <h1 style={{
          fontSize: '32px',
          fontWeight: '300',
          color: '#000000',
          marginBottom: '8px',
          letterSpacing: '-0.5px'
        }}>
          Gesture Control Panel
        </h1>
        <p style={{
          fontSize: '15px',
          color: '#666666',
          fontWeight: '400',
          margin: 0
        }}>
          Control actions with hand gestures using your camera
        </p>
      </div>

      {/* Main Content */}
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '32px' }}>
          {/* Left Column - Video Feed */}
          <div>
            {/* Video Container */}
            <div style={{
              background: '#ffffff',
              borderRadius: '12px',
              padding: '24px',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.04)',
              marginBottom: '24px'
            }}>
              <div style={{
                position: 'relative',
                width: '100%',
                paddingTop: '75%', // 4:3 aspect ratio
                background: '#f8f8f8',
                borderRadius: '8px',
                overflow: 'hidden'
              }}>
                {!cameraActive && !loading && (
                  <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexDirection: 'column',
                    color: '#999999',
                    fontSize: '15px'
                  }}>
                    <svg style={{ width: '48px', height: '48px', marginBottom: '16px', opacity: 0.3 }} fill="currentColor" viewBox="0 0 20 20">
                      <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" />
                    </svg>
                    <span>Camera is off</span>
                  </div>
                )}
                {loading && (
                  <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#666666',
                    fontSize: '15px'
                  }}>
                    Loading camera...
                  </div>
                )}
                {permissionDenied && (
                  <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexDirection: 'column',
                    padding: '32px',
                    color: '#d32f2f',
                    fontSize: '14px',
                    textAlign: 'center'
                  }}>
                    <div style={{ marginBottom: '12px', fontWeight: '500' }}>Camera permission denied</div>
                    <div style={{ color: '#666666', fontSize: '13px' }}>
                      Please allow camera access in your browser settings and refresh the page.
                    </div>
                  </div>
                )}
                <video
                  ref={videoRef}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: 'none'
                  }}
                  playsInline
                />
                <canvas
                  ref={canvasRef}
                  width={640}
                  height={480}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: cameraActive ? 'block' : 'none'
                  }}
                />
              </div>
            </div>

            {/* Controls */}
            <div style={{
              background: '#ffffff',
              borderRadius: '12px',
              padding: '24px',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.04)'
            }}>
              <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
                <button
                  onClick={cameraActive ? stopCamera : startCamera}
                  disabled={loading || !mediapipeReady}
                  style={{
                    flex: 1,
                    padding: '14px 24px',
                    background: cameraActive ? '#ffffff' : '#000000',
                    color: cameraActive ? '#000000' : '#ffffff',
                    border: cameraActive ? '1px solid #e0e0e0' : 'none',
                    borderRadius: '8px',
                    fontSize: '15px',
                    fontWeight: '500',
                    cursor: (loading || !mediapipeReady) ? 'not-allowed' : 'pointer',
                    opacity: (loading || !mediapipeReady) ? 0.5 : 1,
                    transition: 'all 0.2s'
                  }}
                >
                  {loading ? 'Starting...' : cameraActive ? 'Stop Camera' : 'Start Camera'}
                </button>
                <button
                  onClick={clearLog}
                  disabled={actionLog.length === 0}
                  style={{
                    padding: '14px 24px',
                    background: '#ffffff',
                    color: '#000000',
                    border: '1px solid #e0e0e0',
                    borderRadius: '8px',
                    fontSize: '15px',
                    fontWeight: '500',
                    cursor: actionLog.length === 0 ? 'not-allowed' : 'pointer',
                    opacity: actionLog.length === 0 ? 0.5 : 1,
                    transition: 'all 0.2s'
                  }}
                >
                  Clear Log
                </button>
              </div>

              {/* Stability Threshold Slider */}
              <div>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: '12px',
                  fontSize: '14px',
                  color: '#666666'
                }}>
                  <span>Stability Threshold</span>
                  <span style={{ fontWeight: '500', color: '#000000' }}>{majorityThreshold}/5 frames</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="5"
                  step="1"
                  value={majorityThreshold}
                  onChange={(e) => setMajorityThreshold(parseInt(e.target.value))}
                  style={{
                    width: '100%',
                    height: '4px',
                    borderRadius: '2px',
                    outline: 'none',
                    WebkitAppearance: 'none',
                    appearance: 'none',
                    background: `linear-gradient(to right, #000000 0%, #000000 ${((majorityThreshold - 2) / 2) * 100}%, #e0e0e0 ${((majorityThreshold - 2) / 2) * 100}%, #e0e0e0 100%)`
                  }}
                />
                <div style={{
                  marginTop: '8px',
                  fontSize: '12px',
                  color: '#999999',
                  lineHeight: '1.4'
                }}>
                  Higher = more stable but slower response. Actions trigger on change or 2s hold.
                </div>
              </div>
            </div>
          </div>

          {/* Right Column - Status & Log */}
          <div>
            {/* Current Status */}
            <div style={{
              background: '#ffffff',
              borderRadius: '12px',
              padding: '24px',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.04)',
              marginBottom: '24px'
            }}>
              <h3 style={{
                fontSize: '14px',
                fontWeight: '600',
                color: '#999999',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: '16px',
                margin: 0
              }}>
                Current Gesture
              </h3>
              <div style={{
                padding: '20px',
                background: '#f8f8f8',
                borderRadius: '8px',
                textAlign: 'center',
                marginTop: '16px'
              }}>
                <div style={{
                  fontSize: '18px',
                  fontWeight: '500',
                  color: currentGesture && currentGesture !== 'Unknown' ? '#000000' : '#999999'
                }}>
                  {currentGesture || (cameraActive ? 'Detecting...' : 'Camera off')}
                </div>
              </div>
            </div>

            {/* Last Action */}
            <div style={{
              background: '#ffffff',
              borderRadius: '12px',
              padding: '24px',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.04)',
              marginBottom: '24px'
            }}>
              <h3 style={{
                fontSize: '14px',
                fontWeight: '600',
                color: '#999999',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: '16px',
                margin: 0
              }}>
                Last Action
              </h3>
              {lastAction ? (
                <div style={{
                  padding: '16px',
                  background: '#f8f8f8',
                  borderRadius: '8px',
                  marginTop: '16px'
                }}>
                  <div style={{
                    fontSize: '16px',
                    fontWeight: '500',
                    color: '#000000',
                    marginBottom: '4px'
                  }}>
                    {lastAction.action}
                  </div>
                  <div style={{ fontSize: '13px', color: '#999999' }}>
                    {lastAction.gesture} • {lastAction.timestamp}
                  </div>
                </div>
              ) : (
                <div style={{
                  padding: '20px',
                  background: '#f8f8f8',
                  borderRadius: '8px',
                  textAlign: 'center',
                  marginTop: '16px',
                  color: '#999999',
                  fontSize: '14px'
                }}>
                  No actions yet
                </div>
              )}
            </div>

            {/* Action Log */}
            <div style={{
              background: '#ffffff',
              borderRadius: '12px',
              padding: '24px',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.04)'
            }}>
              <h3 style={{
                fontSize: '14px',
                fontWeight: '600',
                color: '#999999',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: '16px',
                margin: 0
              }}>
                Action Log
              </h3>
              <div style={{ marginTop: '16px' }}>
                {actionLog.length === 0 ? (
                  <div style={{
                    padding: '20px',
                    background: '#f8f8f8',
                    borderRadius: '8px',
                    textAlign: 'center',
                    color: '#999999',
                    fontSize: '14px'
                  }}>
                    No actions logged
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '200px', overflowY: 'auto' }}>
                    {actionLog.map((entry, index) => (
                      <div
                        key={index}
                        style={{
                          padding: '12px',
                          background: '#f8f8f8',
                          borderRadius: '6px',
                          fontSize: '13px'
                        }}
                      >
                        <div style={{
                          fontWeight: '500',
                          color: '#000000',
                          marginBottom: '2px'
                        }}>
                          {entry.action}
                        </div>
                        <div style={{ color: '#999999', fontSize: '12px' }}>
                          {entry.gesture} • {entry.timestamp}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Gesture Guide */}
        <div style={{
          background: '#ffffff',
          borderRadius: '12px',
          padding: '32px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.04)',
          marginTop: '32px'
        }}>
          <h3 style={{
            fontSize: '18px',
            fontWeight: '500',
            color: '#000000',
            marginBottom: '24px',
            margin: 0
          }}>
            Supported Gestures
          </h3>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '24px',
            marginTop: '24px'
          }}>
            {[
              { name: 'Index Up', action: 'Confirm', icon: '☝️' },
              { name: 'Open Palm', action: 'Stop', icon: '✋' },
              { name: 'Peace Sign', action: 'Next', icon: '✌️' },
              { name: 'Fist', action: 'Reset', icon: '✊' }
            ].map((gesture, index) => (
              <div
                key={index}
                style={{
                  padding: '24px',
                  background: '#f8f8f8',
                  borderRadius: '8px',
                  textAlign: 'center'
                }}
              >
                <div style={{ fontSize: '48px', marginBottom: '12px' }}>{gesture.icon}</div>
                <div style={{
                  fontSize: '15px',
                  fontWeight: '500',
                  color: '#000000',
                  marginBottom: '4px'
                }}>
                  {gesture.name}
                </div>
                <div style={{ fontSize: '13px', color: '#666666' }}>
                  {gesture.action}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default GestureControlPanel;
