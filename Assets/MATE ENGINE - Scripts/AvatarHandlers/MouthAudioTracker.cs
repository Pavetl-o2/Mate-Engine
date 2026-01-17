using UnityEngine;
using System.Collections.Generic;
using System.Linq;

[DisallowMultipleComponent]
[RequireComponent(typeof(UniversalBlendshapes))]
public class MouthAudioTracker : MonoBehaviour
{
    [Header("Microphone Settings")]
    [Tooltip("Leave empty to use default microphone")]
    public string microphoneDevice = "";
    public int sampleRate = 44100;
    public int recordingLength = 1;

    [Header("Analysis Settings")]
    [Range(256, 8192)]
    public int fftSize = 1024;
    [Range(0.01f, 0.2f)]
    public float updateInterval = 0.05f;
    [Range(1, 60)]
    public int historySeconds = 10;

    [Header("Sensitivity Thresholds")]
    [Tooltip("Minimum RMS to start talking (closed -> half)")]
    [Range(0.0001f, 0.01f)]
    public float talkThreshold = 0.001f;

    [Tooltip("RMS for half-open mouth (half -> open)")]
    [Range(0.001f, 0.05f)]
    public float halfThreshold = 0.005f;

    [Tooltip("RMS for fully open mouth")]
    [Range(0.005f, 0.1f)]
    public float openThreshold = 0.015f;

    [Tooltip("Spectral centroid threshold to distinguish U from E (higher = E, lower = U)")]
    [Range(1000f, 8000f)]
    public float spectralThreshold = 3000f;

    [Header("Timing Settings")]
    [Tooltip("Minimum time between mouth shape changes")]
    [Range(0.05f, 0.5f)]
    public float minShapeChangeInterval = 0.12f;

    [Tooltip("How long to hold open/U/E states before returning to closed")]
    [Range(0.05f, 0.3f)]
    public float holdTime = 0.15f;

    [Header("Smoothing")]
    [Tooltip("How quickly mouth opens (higher = faster)")]
    [Range(1f, 20f)]
    public float mouthOpenSpeed = 10f;

    [Tooltip("How quickly mouth closes (higher = faster)")]
    [Range(1f, 20f)]
    public float mouthCloseSpeed = 8f;

    [Header("Debug")]
    public bool showDebugInfo = false;
    public bool enableTracking = true;

    // Private variables
    private UniversalBlendshapes blendshapes;
    private CustomDancePlayer.AvatarDanceHandler danceHandler;

    private AudioClip microphoneClip;
    private int lastSample = 0;
    private float[] samples;
    private float[] spectrum;

    private Queue<float> rmsHistory;
    private Queue<float> centroidHistory;
    private float nextUpdateTime = 0f;
    private float lastShapeChangeTime = 0f;

    private MouthState currentState = MouthState.Closed;
    private MouthState targetState = MouthState.Closed;
    private float currentMouthValue = 0f;
    private float targetMouthValue = 0f;

    private float lastPeakTime = 0f;
    private bool microphoneInitialized = false;

    private enum MouthState
    {
        Closed,  // No sound
        Half,    // Low volume
        Open,    // Medium volume (generic vowel)
        U,       // High volume + low frequency
        E        // High volume + high frequency
    }

    void Awake()
    {
        blendshapes = GetComponent<UniversalBlendshapes>();
        samples = new float[fftSize];
        spectrum = new float[fftSize];

        int historySize = Mathf.RoundToInt(historySeconds / updateInterval);
        rmsHistory = new Queue<float>(historySize);
        centroidHistory = new Queue<float>(historySize);
    }

    void Start()
    {
        danceHandler = FindFirstObjectByType<CustomDancePlayer.AvatarDanceHandler>();
        InitializeMicrophone();
    }

    void OnEnable()
    {
        if (microphoneInitialized)
        {
            InitializeMicrophone();
        }
    }

    void OnDisable()
    {
        StopMicrophone();
    }

    void OnDestroy()
    {
        StopMicrophone();
    }

    private void InitializeMicrophone()
    {
        StopMicrophone();

        if (!enableTracking) return;

        // Get available microphones
        string[] devices = Microphone.devices;
        if (devices.Length == 0)
        {
            Debug.LogWarning("MouthAudioTracker: No microphone devices found!");
            return;
        }

        // Use specified device or default
        string deviceToUse = microphoneDevice;
        if (string.IsNullOrEmpty(deviceToUse) || !devices.Contains(deviceToUse))
        {
            deviceToUse = devices[0];
            if (showDebugInfo)
                Debug.Log($"MouthAudioTracker: Using default microphone: {deviceToUse}");
        }

        try
        {
            microphoneClip = Microphone.Start(deviceToUse, true, recordingLength, sampleRate);
            if (microphoneClip == null)
            {
                Debug.LogError("MouthAudioTracker: Failed to start microphone!");
                return;
            }

            // Wait for microphone to start
            int timeout = 0;
            while (!(Microphone.GetPosition(deviceToUse) > 0) && timeout < 1000)
            {
                timeout++;
            }

            microphoneInitialized = true;
            lastSample = 0;

            if (showDebugInfo)
                Debug.Log($"MouthAudioTracker: Microphone initialized (device: {deviceToUse}, sample rate: {sampleRate})");
        }
        catch (System.Exception e)
        {
            Debug.LogError($"MouthAudioTracker: Error initializing microphone: {e.Message}");
            microphoneInitialized = false;
        }
    }

    private void StopMicrophone()
    {
        if (microphoneClip != null)
        {
            string deviceToUse = string.IsNullOrEmpty(microphoneDevice) ? null : microphoneDevice;
            Microphone.End(deviceToUse);
            microphoneClip = null;
        }
        microphoneInitialized = false;
        lastSample = 0;
    }

    void Update()
    {
        if (!enableTracking || !microphoneInitialized || microphoneClip == null)
        {
            // Smoothly return mouth to closed
            targetState = MouthState.Closed;
            targetMouthValue = 0f;
            UpdateMouthBlendshapes();
            return;
        }

        // Don't track if dance is playing (let AvatarDanceShapeConverter handle it)
        if (danceHandler != null && danceHandler.IsPlaying)
        {
            targetState = MouthState.Closed;
            targetMouthValue = 0f;
            UpdateMouthBlendshapes();
            return;
        }

        // Update at specified interval
        if (Time.time < nextUpdateTime)
        {
            UpdateMouthBlendshapes();
            return;
        }

        nextUpdateTime = Time.time + updateInterval;

        // Get audio data
        int currentPosition = Microphone.GetPosition(microphoneDevice);
        if (currentPosition < 0 || currentPosition == lastSample)
        {
            UpdateMouthBlendshapes();
            return;
        }

        // Read audio samples
        int samplesToRead = fftSize;
        int startPosition = currentPosition - samplesToRead;
        if (startPosition < 0)
            startPosition += microphoneClip.samples;

        microphoneClip.GetData(samples, startPosition);
        lastSample = currentPosition;

        // Analyze audio
        float rms = CalculateRMS(samples);
        float centroid = CalculateSpectralCentroid(samples);

        // Add to history
        UpdateHistory(rms, centroid);

        // Determine mouth state based on audio
        DetermineMouthState(rms, centroid);

        // Update blendshapes
        UpdateMouthBlendshapes();

        // Debug output
        if (showDebugInfo && Time.frameCount % 30 == 0)
        {
            Debug.Log($"MouthAudioTracker: RMS={rms:F6}, Centroid={centroid:F1}Hz, State={currentState}");
        }
    }

    private float CalculateRMS(float[] audioSamples)
    {
        float sum = 0f;
        for (int i = 0; i < audioSamples.Length; i++)
        {
            sum += audioSamples[i] * audioSamples[i];
        }
        return Mathf.Sqrt(sum / audioSamples.Length);
    }

    private float CalculateSpectralCentroid(float[] audioSamples)
    {
        // Apply FFT
        for (int i = 0; i < fftSize; i++)
        {
            spectrum[i] = audioSamples[i];
        }

        // Simple magnitude calculation (Unity doesn't have built-in FFT, so we use GetSpectrumData)
        // As a workaround, we'll use a simplified frequency analysis
        float lowFreqEnergy = 0f;
        float highFreqEnergy = 0f;

        int lowBand = fftSize / 4;  // Lower quarter
        int highBand = fftSize / 2;  // Upper half

        for (int i = 0; i < lowBand; i++)
        {
            lowFreqEnergy += Mathf.Abs(audioSamples[i]);
        }

        for (int i = lowBand; i < highBand; i++)
        {
            highFreqEnergy += Mathf.Abs(audioSamples[i]);
        }

        // Estimate centroid based on energy distribution
        float ratio = highFreqEnergy / (lowFreqEnergy + highFreqEnergy + 0.0001f);
        return ratio * sampleRate * 0.5f;  // Approximate centroid in Hz
    }

    private void UpdateHistory(float rms, float centroid)
    {
        int maxHistory = Mathf.RoundToInt(historySeconds / updateInterval);

        rmsHistory.Enqueue(rms);
        centroidHistory.Enqueue(centroid);

        while (rmsHistory.Count > maxHistory)
            rmsHistory.Dequeue();
        while (centroidHistory.Count > maxHistory)
            centroidHistory.Dequeue();
    }

    private void DetermineMouthState(float rms, float centroid)
    {
        float timeSinceLastChange = Time.time - lastShapeChangeTime;

        // If below talk threshold, mouth is closed
        if (rms < talkThreshold)
        {
            // Hold current state briefly before closing
            if (Time.time - lastPeakTime > holdTime)
            {
                targetState = MouthState.Closed;
                targetMouthValue = 0f;
            }
            return;
        }

        // Detect if we're in a peak (significant sound)
        bool isPeak = rms > halfThreshold;
        if (isPeak)
        {
            lastPeakTime = Time.time;
        }

        // Don't change state too frequently
        if (timeSinceLastChange < minShapeChangeInterval && targetState != MouthState.Closed)
        {
            return;
        }

        // Determine new state based on RMS and centroid
        MouthState newState;
        float newValue;

        if (rms < halfThreshold)
        {
            // Low volume - half open
            newState = MouthState.Half;
            newValue = Mathf.Clamp01(rms / halfThreshold);
        }
        else if (rms < openThreshold)
        {
            // Medium volume - open (generic)
            newState = MouthState.Open;
            newValue = Mathf.Clamp01(rms / openThreshold);
        }
        else
        {
            // High volume - distinguish between U and E based on frequency
            if (centroid > spectralThreshold)
            {
                newState = MouthState.E;  // Higher frequency
            }
            else
            {
                newState = MouthState.U;  // Lower frequency
            }
            newValue = Mathf.Clamp01(rms / openThreshold);
        }

        // Update target state
        if (newState != targetState || Mathf.Abs(newValue - targetMouthValue) > 0.1f)
        {
            targetState = newState;
            targetMouthValue = newValue;
            lastShapeChangeTime = Time.time;
        }
    }

    private void UpdateMouthBlendshapes()
    {
        if (blendshapes == null) return;

        // Smooth transition
        float speed = (targetMouthValue > currentMouthValue) ? mouthOpenSpeed : mouthCloseSpeed;
        currentMouthValue = Mathf.Lerp(currentMouthValue, targetMouthValue, Time.deltaTime * speed);
        currentState = targetState;

        // Reset all mouth shapes
        blendshapes.A = 0f;
        blendshapes.I = 0f;
        blendshapes.U = 0f;
        blendshapes.E = 0f;
        blendshapes.O = 0f;

        // Apply current state
        switch (currentState)
        {
            case MouthState.Closed:
                // All zeros (already set above)
                break;

            case MouthState.Half:
                // Slight mouth opening - use a mix of I and A
                blendshapes.I = currentMouthValue * 0.3f;
                blendshapes.A = currentMouthValue * 0.2f;
                break;

            case MouthState.Open:
                // Generic open mouth - use A (most open)
                blendshapes.A = currentMouthValue * 0.8f;
                break;

            case MouthState.U:
                // U shape - rounded lips
                blendshapes.U = currentMouthValue;
                break;

            case MouthState.E:
                // E shape - wide mouth
                blendshapes.E = currentMouthValue;
                break;
        }
    }

    // Public methods for runtime control
    public void SetEnableTracking(bool enable)
    {
        if (enableTracking != enable)
        {
            enableTracking = enable;
            if (enable)
            {
                InitializeMicrophone();
            }
            else
            {
                StopMicrophone();
            }
        }
    }

    public void ResetThresholdsToDefault()
    {
        talkThreshold = 0.001f;
        halfThreshold = 0.005f;
        openThreshold = 0.015f;
        spectralThreshold = 3000f;
        minShapeChangeInterval = 0.12f;
        holdTime = 0.15f;
        mouthOpenSpeed = 10f;
        mouthCloseSpeed = 8f;
    }

    public float GetCurrentRMS()
    {
        return rmsHistory.Count > 0 ? rmsHistory.Last() : 0f;
    }

    public float GetCurrentCentroid()
    {
        return centroidHistory.Count > 0 ? centroidHistory.Last() : 0f;
    }
}
